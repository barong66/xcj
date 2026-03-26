package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/store"
)

const (
	grokEndpoint  = "https://api.x.ai/v1/chat/completions"
	grokModel     = "grok-3"
	grokMaxTokens = 300
	grokTimeout   = 10 * time.Second
)

// ctaPattern matches [CTA:{"text":"...","url":"..."}] at end of Grok response
var ctaPattern = regexp.MustCompile(`\[CTA:(\{[^]]+\})\]`)

// ChatConfigProvider is the interface ChatHandler depends on.
type ChatConfigProvider interface {
	GetChatConfig(ctx context.Context, siteID int64, slug string) (*store.ChatConfig, error)
}

// ChatHandler handles AI chat requests.
type ChatHandler struct {
	store        ChatConfigProvider
	cache        *cache.Cache
	apiKey       string
	greetClient  *http.Client // short timeout — for greeting generation
	streamClient *http.Client // no client-level timeout — streaming uses request context
}

// NewChatHandler creates a ChatHandler.
func NewChatHandler(store ChatConfigProvider, c *cache.Cache, apiKey string) *ChatHandler {
	return &ChatHandler{
		store:        store,
		cache:        c,
		apiKey:       apiKey,
		greetClient:  &http.Client{Timeout: grokTimeout},
		streamClient: &http.Client{}, // timeout managed via request context
	}
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatMessageRequest struct {
	ModelSlug string        `json:"model_slug"`
	Message   string        `json:"message"`
	History   []chatMessage `json:"history"`
}

type ctaData struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

// Config handles GET /api/v1/chat/config?slug={slug}
func (h *ChatHandler) Config(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	slug := r.URL.Query().Get("slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug is required")
		return
	}

	cfg, err := h.store.GetChatConfig(r.Context(), site.ID, slug)
	if err != nil {
		slog.Error("chat: load config", "error", err, "slug", slug)
		writeError(w, http.StatusInternalServerError, "failed to load chat config")
		return
	}

	if cfg == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"data":   map[string]any{"enabled": false},
			"status": "ok",
		})
		return
	}

	greeting := h.generateGreeting(r.Context(), cfg)

	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"enabled":    true,
			"model_name": cfg.Name,
			"greeting":   greeting,
		},
		"status": "ok",
	})
}

// Message handles POST /api/v1/chat/message and streams the response via SSE.
func (h *ChatHandler) Message(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	var req chatMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ModelSlug == "" {
		writeError(w, http.StatusBadRequest, "model_slug is required")
		return
	}
	if strings.TrimSpace(req.Message) == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	cfg, err := h.store.GetChatConfig(r.Context(), site.ID, req.ModelSlug)
	if err != nil || cfg == nil {
		writeError(w, http.StatusNotFound, "chat not available for this model")
		return
	}

	history := req.History
	if len(history) > 20 {
		history = history[len(history)-20:]
	}

	systemPrompt := h.buildSystemPrompt(cfg)

	messages := make([]chatMessage, 0, len(history)+2)
	messages = append(messages, chatMessage{Role: "system", Content: systemPrompt})
	messages = append(messages, history...)
	messages = append(messages, chatMessage{Role: "user", Content: req.Message})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	if err := h.streamGrokResponse(r.Context(), messages, w, flusher); err != nil {
		slog.Error("chat: stream grok response", "error", err)
		fmt.Fprintf(w, "data: {\"error\":\"unavailable\"}\n\n")
		flusher.Flush()
	}
}

func (h *ChatHandler) streamGrokResponse(ctx context.Context, messages []chatMessage, w http.ResponseWriter, flusher http.Flusher) error {
	payload := map[string]any{
		"model":       grokModel,
		"messages":    messages,
		"max_tokens":  grokMaxTokens,
		"stream":      true,
		"temperature": 0.9,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", grokEndpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+h.apiKey)

	resp, err := h.streamClient.Do(req)
	if err != nil {
		return fmt.Errorf("grok request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("grok returned %d", resp.StatusCode)
	}

	var fullText strings.Builder
	inCTATag := false
	scanner := bufio.NewScanner(resp.Body)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}

		delta := chunk.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		fullText.WriteString(delta)

		// Suppress streaming once CTA tag begins (may span multiple tokens)
		if !inCTATag && strings.Contains(fullText.String(), "[CTA:") {
			inCTATag = true
		}
		if !inCTATag {
			event, _ := json.Marshal(map[string]string{"delta": delta})
			fmt.Fprintf(w, "data: %s\n\n", event)
			flusher.Flush()
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("reading grok stream: %w", err)
	}

	// Extract CTA from full response
	var cta *ctaData
	full := fullText.String()
	if m := ctaPattern.FindStringSubmatch(full); len(m) == 2 {
		var parsed ctaData
		if err := json.Unmarshal([]byte(m[1]), &parsed); err == nil && parsed.URL != "" {
			cta = &parsed
		}
	}

	donePayload := map[string]any{"done": true}
	if cta != nil {
		donePayload["cta"] = cta
	}
	event, _ := json.Marshal(donePayload)
	fmt.Fprintf(w, "data: %s\n\n", event)
	flusher.Flush()

	return nil
}

func (h *ChatHandler) buildSystemPrompt(cfg *store.ChatConfig) string {
	if cfg.ChatPrompt != nil && strings.TrimSpace(*cfg.ChatPrompt) != "" {
		return *cfg.ChatPrompt
	}

	country := cfg.Country
	if country == "" {
		country = "unknown location"
	}
	categories := strings.Join(cfg.Categories, ", ")
	if categories == "" {
		categories = "lifestyle, content creation"
	}

	links := []string{}
	for _, key := range []string{"onlyfans", "instagram", "twitter", "fansly"} {
		if v, ok := cfg.SocialLinks[key]; ok && v != "" {
			url := v
			if !strings.HasPrefix(url, "http") {
				prefixes := map[string]string{
					"onlyfans":  "https://onlyfans.com/",
					"instagram": "https://instagram.com/",
					"twitter":   "https://x.com/",
					"fansly":    "https://fansly.com/",
				}
				url = prefixes[key] + url
			}
			links = append(links, fmt.Sprintf("- %s: %s", key, url))
		}
	}

	adInstruction := ""
	if cfg.ChatAdText != nil && strings.TrimSpace(*cfg.ChatAdText) != "" {
		adInstruction = fmt.Sprintf(`When the conversation feels warm and the user is engaged, naturally insert this promotion in your message: "%s". Make it feel organic, not forced.`, *cfg.ChatAdText)
	} else if len(links) > 0 {
		adInstruction = "When the conversation feels warm and the user is engaged, naturally mention one of your links. Make it feel organic."
	}

	linksSection := ""
	if len(links) > 0 {
		linksSection = "Your links:\n" + strings.Join(links, "\n")
	}

	prompt := fmt.Sprintf(`You are %s, a content creator from %s.
Your personality: flirty, fun, confident, warm, a little playful.
You're known for: %s.

You are chatting with a fan on your website. Keep responses short (1-3 sentences max).
Be engaging, personal, and use occasional emojis. Never break character.
Never reveal you are an AI.

%s

%s

When you include a link in your message as a CTA, also append at the very end of your response (on a new line, after everything else):
[CTA:{"text":"descriptive button text","url":"the full URL"}]
Only include this tag if you are actually promoting a link. Do not include it in every message.`,
		cfg.Name, country, categories, linksSection, adInstruction,
	)

	return strings.TrimSpace(prompt)
}

func (h *ChatHandler) generateGreeting(ctx context.Context, cfg *store.ChatConfig) string {
	fallback := "Hey! \U0001f60a So glad you stopped by..."

	// Check Redis cache first (key: chat:greeting:{username})
	if h.cache != nil {
		var cached string
		if h.cache.GetJSON(ctx, "chat:greeting:"+cfg.Username, &cached) && cached != "" {
			return cached
		}
	}

	if h.apiKey == "" {
		return fallback
	}

	systemPrompt := h.buildSystemPrompt(cfg)
	messages := []chatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: "Say a short, flirty opening message to a fan who just opened your chat. 1-2 sentences, no CTA tag."},
	}

	payload := map[string]any{
		"model":      grokModel,
		"messages":   messages,
		"max_tokens": 80,
		"stream":     false,
	}
	body, _ := json.Marshal(payload)

	greetCtx, cancel := context.WithTimeout(ctx, grokTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(greetCtx, "POST", grokEndpoint, bytes.NewReader(body))
	if err != nil {
		return fallback
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+h.apiKey)

	resp, err := h.greetClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return fallback
	}
	defer resp.Body.Close()

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result.Choices) == 0 {
		return fallback
	}

	greeting := strings.TrimSpace(result.Choices[0].Message.Content)
	greeting = ctaPattern.ReplaceAllString(greeting, "")
	if greeting == "" {
		return fallback
	}

	// Cache in Redis for 24h
	if h.cache != nil {
		h.cache.SetJSON(ctx, "chat:greeting:"+cfg.Username, greeting, 24*time.Hour)
	}
	return greeting
}
