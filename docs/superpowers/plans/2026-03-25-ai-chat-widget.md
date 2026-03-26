# AI Chat Widget Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen AI chat widget to model profile pages that impersonates the model using Grok, streams responses, inserts CTAs, and persists history in localStorage.

**Architecture:** Chat button in ProfileHeader → full-screen ChatScreen → POST /api/v1/chat/message → Go API builds system prompt from account data → streams Grok response via SSE back to browser. History stored in localStorage (50 msg max, 20 sent as context).

**Tech Stack:** Go (net/http SSE streaming, xAI Grok API), Next.js 14 (Client Components, SSE fetch), TypeScript, Tailwind CSS, PostgreSQL migration, Redis (greeting cache)

---

## File Structure

**New files:**
- `scripts/migrations/017_chat_settings.sql` — 3 new columns on accounts
- `api/internal/handler/chat.go` — ChatHandler (GET /chat/config, POST /chat/message)
- `api/internal/store/chat_store.go` — load chat config for a model slug
- `web/src/templates/default/ChatButton.tsx` — "💬 Chat" button (client component)
- `web/src/templates/default/ChatScreen.tsx` — full-screen chat UI (client component)
- `web/src/templates/default/chatHistory.ts` — localStorage utility

**Modified files:**
- `api/internal/config/config.go` — add XAI_API_KEY
- `api/internal/handler/router.go` — register /api/v1/chat/* routes
- `api/internal/store/admin_store.go` — extend UpdateAccountInput with chat fields
- `api/internal/handler/event.go` — add chat event types to validEventTypes
- `web/src/types/index.ts` — add chat_enabled to Account interface
- `web/src/templates/default/ProfileHeader.tsx` — render ChatButton when chat_enabled
- `web/src/lib/admin-api.ts` — extend updateAdminAccount with chat fields
- `web/src/app/admin/accounts/[id]/page.tsx` — add Chat Settings tab

---

## Chunk 1: Backend — DB, Config, Store, Chat Handler

### Task 1: Database migration

**Files:**
- Create: `scripts/migrations/017_chat_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 017: Add AI chat widget settings to accounts
-- Enables per-model AI companion chat powered by Grok.

ALTER TABLE accounts ADD COLUMN chat_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN chat_prompt TEXT;
ALTER TABLE accounts ADD COLUMN chat_ad_text TEXT;
```

- [ ] **Step 2: Apply migration to local dev DB**

```bash
cat scripts/migrations/017_chat_settings.sql | docker exec -i traforama-postgres psql -U xcj -d xcj
```

Expected output:
```
ALTER TABLE
ALTER TABLE
ALTER TABLE
```

- [ ] **Step 3: Commit**

```bash
git add scripts/migrations/017_chat_settings.sql
git commit -m "chore(db): migration 017 — add chat_enabled, chat_prompt, chat_ad_text to accounts"
```

---

### Task 2: Add XAI_API_KEY to config

**Files:**
- Modify: `api/internal/config/config.go`

- [ ] **Step 1: Write a failing test**

Create `api/internal/config/config_test.go` (or add to existing if it exists):

```go
package config

import (
    "os"
    "testing"
)

func TestConfig_XAIAPIKey(t *testing.T) {
    os.Setenv("XAI_API_KEY", "test-key-123")
    defer os.Unsetenv("XAI_API_KEY")

    cfg := Load()
    if cfg.XAIAPIKey != "test-key-123" {
        t.Errorf("expected XAIAPIKey=test-key-123, got %q", cfg.XAIAPIKey)
    }
}

func TestConfig_XAIAPIKey_Default(t *testing.T) {
    os.Unsetenv("XAI_API_KEY")
    cfg := Load()
    if cfg.XAIAPIKey != "" {
        t.Errorf("expected empty XAIAPIKey by default, got %q", cfg.XAIAPIKey)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd api && go test ./internal/config/... -v -run TestConfig_XAI
```

Expected: FAIL (XAIAPIKey field does not exist)

- [ ] **Step 3: Add XAIAPIKey to config**

In `api/internal/config/config.go`, add to `Config` struct:
```go
// xAI / Grok
XAIAPIKey string
```

Add to `Load()` function:
```go
XAIAPIKey: envOrDefault("XAI_API_KEY", ""),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd api && go test ./internal/config/... -v -run TestConfig_XAI
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/internal/config/config.go api/internal/config/config_test.go
git commit -m "feat(config): add XAI_API_KEY for Grok API"
```

Note: Wiring `XAIAPIKey` into `NewRouter()` and `main.go` is done in Task 5 together with route registration.

---

### Task 3: Chat store — load account chat config by slug

**Files:**
- Create: `api/internal/store/chat_store.go`

- [ ] **Step 1: Write the failing test**

Create `api/internal/store/chat_store_test.go`:

```go
package store_test

import (
    "testing"
)

// Integration test — requires DB. Run with: go test ./internal/store/... -tags integration
// For unit coverage, the struct/interface is tested via mock in handler tests.

func TestChatStore_GetChatConfig_NotFound(t *testing.T) {
    // This test documents the expected behavior:
    // GetChatConfig returns nil, nil when slug not found.
    // Tested via handler mock in Task 4 tests.
    t.Skip("integration test — see chat_handler_test.go for mock-based coverage")
}
```

- [ ] **Step 2: Create shared helpers file (if not exists)**

Check if `api/internal/store/helpers.go` exists. If not, create it:

```go
package store

import "encoding/json"

// unmarshalJSON is a generic helper for deserializing JSONB columns.
// Defined here (not in individual store files) to avoid redeclaration conflicts.
func unmarshalJSON[T any](data []byte, v *T) error {
    if len(data) == 0 {
        return nil
    }
    return json.Unmarshal(data, v)
}
```

- [ ] **Step 3: Write the chat store**

Create `api/internal/store/chat_store.go`:

```go
package store

import (
    "context"
    "errors"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

// ChatConfig holds the data needed to build a Grok system prompt for a model.
type ChatConfig struct {
    AccountID   int64
    Name        string
    Username    string
    Country     string
    Categories  []string
    SocialLinks map[string]string
    ChatPrompt  *string // nil = auto-generate
    ChatAdText  *string // nil = use social links
}

// ChatStore queries account data needed for the chat feature.
type ChatStore struct {
    pool *pgxpool.Pool
}

// NewChatStore creates a ChatStore.
func NewChatStore(pool *pgxpool.Pool) *ChatStore {
    return &ChatStore{pool: pool}
}

// GetChatConfig returns chat configuration for an account by slug.
// Returns nil, nil if the account doesn't exist or chat is disabled.
func (s *ChatStore) GetChatConfig(ctx context.Context, siteID int64, slug string) (*ChatConfig, error) {
    var cfg ChatConfig
    var socialLinksJSON []byte
    var categoriesJSON []byte

    err := s.pool.QueryRow(ctx, `
        SELECT
            a.id,
            COALESCE(a.display_name, a.username),
            a.username,
            COALESCE(a.country, ''),
            COALESCE(a.social_links, '{}'),
            COALESCE(
                (SELECT jsonb_agg(DISTINCT c.name)
                 FROM video_categories vc
                 JOIN categories c ON c.id = vc.category_id
                 JOIN videos v ON v.id = vc.video_id
                 WHERE v.account_id = a.id
                 LIMIT 5),
                '[]'
            ),
            a.chat_prompt,
            a.chat_ad_text
        FROM accounts a
        WHERE (a.slug = $1 OR a.username = $1)
          AND a.is_active = true
          AND a.chat_enabled = true
          AND EXISTS (
              SELECT 1 FROM videos v
              JOIN site_videos sv ON sv.video_id = v.id
              WHERE v.account_id = a.id AND sv.site_id = $2
          )
    `, slug, siteID).Scan(
        &cfg.AccountID,
        &cfg.Name,
        &cfg.Username,
        &cfg.Country,
        &socialLinksJSON,
        &categoriesJSON,
        &cfg.ChatPrompt,
        &cfg.ChatAdText,
    )
    if err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return nil, nil
        }
        return nil, err
    }

    // Unmarshal JSON fields (unmarshalJSON is defined in helpers.go)
    if err := unmarshalJSON(socialLinksJSON, &cfg.SocialLinks); err != nil {
        cfg.SocialLinks = map[string]string{}
    }
    if err := unmarshalJSON(categoriesJSON, &cfg.Categories); err != nil {
        cfg.Categories = []string{}
    }

    return &cfg, nil
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd api && go build ./internal/store/...
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add api/internal/store/helpers.go api/internal/store/chat_store.go api/internal/store/chat_store_test.go
git commit -m "feat(store): add ChatStore and helpers for loading model chat config"
```

---

### Task 4: Chat handler — GET /chat/config and POST /chat/message (SSE)

**Files:**
- Create: `api/internal/handler/chat.go`

- [ ] **Step 1: Write failing tests**

Create `api/internal/handler/chat_handler_test.go`:

```go
package handler_test

import (
    "context"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"

    "github.com/xcj/videosite-api/internal/middleware"
    "github.com/xcj/videosite-api/internal/model"
    "github.com/xcj/videosite-api/internal/store"
)

// mockChatStore satisfies ChatConfigProvider without a real DB.
type mockChatStore struct {
    config *store.ChatConfig
}

func (m *mockChatStore) GetChatConfig(ctx context.Context, siteID int64, slug string) (*store.ChatConfig, error) {
    return m.config, nil
}

// withMockSite injects a fake site into the request context (same as middleware.SiteDetection would do).
func withMockSite(r *http.Request) *http.Request {
    return r.WithContext(middleware.WithSite(r.Context(), &model.Site{ID: 1}))
}

func TestChatHandler_Config_DisabledAccount(t *testing.T) {
    h := NewChatHandler(&mockChatStore{config: nil}, nil, "test-key")
    req := httptest.NewRequest("GET", "/api/v1/chat/config?slug=unknown", nil)
    req = withMockSite(req)
    w := httptest.NewRecorder()

    h.Config(w, req)

    if w.Code != http.StatusOK {
        t.Errorf("expected 200, got %d", w.Code)
    }
    var resp map[string]any
    if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
        t.Fatalf("invalid JSON response: %v", err)
    }
    data := resp["data"].(map[string]any)
    if data["enabled"] != false {
        t.Errorf("expected enabled=false for disabled account")
    }
}

func TestChatHandler_Message_MissingSlug(t *testing.T) {
    h := NewChatHandler(&mockChatStore{config: nil}, nil, "test-key")
    body := `{"model_slug":"","message":"hi","history":[]}`
    req := httptest.NewRequest("POST", "/api/v1/chat/message", strings.NewReader(body))
    req = withMockSite(req)
    w := httptest.NewRecorder()

    h.Message(w, req)

    if w.Code != http.StatusBadRequest {
        t.Errorf("expected 400, got %d", w.Code)
    }
}
```

**Note on `middleware.WithSite`:** Check `api/internal/middleware/site.go` to confirm the exact function signature. It may be named differently (e.g., `SetSite`, `ContextWithSite`). Use whatever function the middleware uses to inject a `*model.Site` into the context.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/handler/... -v -run TestChatHandler
```

Expected: FAIL (ChatHandler not defined)

- [ ] **Step 3: Write the chat handler**

Create `api/internal/handler/chat.go`:

```go
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
    grokEndpoint    = "https://api.x.ai/v1/chat/completions"
    grokModel       = "grok-3"
    grokMaxTokens   = 300
    grokTimeout     = 10 * time.Second
    greetingCacheTTL = 24 * 60 * 60 // 24h in seconds
)

// ctaPattern matches [CTA:{"text":"...","url":"..."}] at end of Grok response
var ctaPattern = regexp.MustCompile(`\[CTA:(\{[^]]+\})\]`)

// ChatConfigProvider is the interface ChatHandler depends on.
type ChatConfigProvider interface {
    GetChatConfig(ctx context.Context, siteID int64, slug string) (*store.ChatConfig, error)
}

// ChatHandler handles AI chat requests.
type ChatHandler struct {
    store         ChatConfigProvider
    cache         *cache.Cache
    apiKey        string
    greetClient   *http.Client // short timeout — for greeting generation
    streamClient  *http.Client // no client-level timeout — streaming uses request context
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

// chatMessage represents a single message in the conversation.
type chatMessage struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

// chatMessageRequest is the POST /chat/message request body.
type chatMessageRequest struct {
    ModelSlug string        `json:"model_slug"`
    Message   string        `json:"message"`
    History   []chatMessage `json:"history"`
}

// ctaData is embedded in the done SSE event when the agent inserts a CTA.
type ctaData struct {
    Text string `json:"text"`
    URL  string `json:"url"`
}

// Config handles GET /api/v1/chat/config?slug={slug}
// Returns {enabled, model_name, greeting} for the model.
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

    // Generate greeting via Grok (with fallback)
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

    // Trim history to last 20 messages
    history := req.History
    if len(history) > 20 {
        history = history[len(history)-20:]
    }

    // Build system prompt
    systemPrompt := h.buildSystemPrompt(cfg)

    // Build messages for Grok
    messages := make([]chatMessage, 0, len(history)+2)
    messages = append(messages, chatMessage{Role: "system", Content: systemPrompt})
    messages = append(messages, history...)
    messages = append(messages, chatMessage{Role: "user", Content: req.Message})

    // Set SSE headers
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

// streamGrokResponse calls Grok with streaming and forwards SSE events to the client.
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
    inCTATag := false // true once we see "[CTA:" start accumulating in fullText
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

    // Send done event
    donePayload := map[string]any{"done": true}
    if cta != nil {
        donePayload["cta"] = cta
    }
    event, _ := json.Marshal(donePayload)
    fmt.Fprintf(w, "data: %s\n\n", event)
    flusher.Flush()

    return nil
}

// buildSystemPrompt constructs the Grok system prompt from account data.
func (h *ChatHandler) buildSystemPrompt(cfg *store.ChatConfig) string {
    // If admin set a custom prompt, use it verbatim
    if cfg.ChatPrompt != nil && strings.TrimSpace(*cfg.ChatPrompt) != "" {
        return *cfg.ChatPrompt
    }

    // Auto-generate from account data
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
        cfg.Name,
        country,
        categories,
        func() string {
            if len(links) > 0 {
                return "Your links:\n" + strings.Join(links, "\n")
            }
            return ""
        }(),
        adInstruction,
    )

    return strings.TrimSpace(prompt)
}

// generateGreeting returns a greeting for the model, using Redis cache (24h TTL).
// Falls back to a static greeting on Grok error.
func (h *ChatHandler) generateGreeting(ctx context.Context, cfg *store.ChatConfig) string {
    fallback := "Hey! 😊 So glad you stopped by..."

    // Check Redis cache first (key: chat:greeting:{slug})
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
    // Strip any accidental CTA tags from greeting
    greeting = ctaPattern.ReplaceAllString(greeting, "")
    if greeting == "" {
        return fallback
    }

    // Cache in Redis for 24h to avoid repeated Grok calls on page loads
    if h.cache != nil {
        h.cache.SetJSON(ctx, "chat:greeting:"+cfg.Username, greeting, 24*time.Hour)
    }
    return greeting
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd api && go test ./internal/handler/... -v -run TestChatHandler
```

Expected: PASS

- [ ] **Step 5: Build to verify compilation**

```bash
cd api && go build ./...
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add api/internal/handler/chat.go api/internal/handler/chat_handler_test.go
git commit -m "feat(api): add ChatHandler with Grok SSE streaming"
```

---

### Task 5: Register chat routes in router

**Files:**
- Modify: `api/internal/handler/router.go`

- [ ] **Step 1: Add chat routes to router**

In `NewRouter()` in `api/internal/handler/router.go`, add after the existing public routes block (inside the `r.Route("/api/v1", ...)` section):

```go
// Chat routes (public, requires site detection)
chatStore := store.NewChatStore(pool)
chatHandler := NewChatHandler(chatStore, c, xaiAPIKey)
r.Get("/chat/config", chatHandler.Config)
r.Post("/chat/message", chatHandler.Message)
```

Note: `c *cache.Cache` is already a parameter of `NewRouter()` — pass it directly to `NewChatHandler`. No new router parameter needed for cache.

Also:
1. Add `xaiAPIKey string` as the **last parameter** of `NewRouter()`, after `corsOrigins []string`:
```go
func NewRouter(
    pool *pgxpool.Pool,
    // ... existing params ...
    adminToken string,
    corsOrigins []string,
    xaiAPIKey string,   // ← add here
) http.Handler {
```
2. Update `api/cmd/server/main.go` to pass `cfg.XAIAPIKey` as the last argument to `NewRouter()`
3. **WriteTimeout fix:** In `api/cmd/server/main.go`, the `http.Server` has `WriteTimeout: 30 * time.Second`. This will cut off SSE streams after 30 seconds. Change it to `WriteTimeout: 0` (disabled) to support long-lived SSE connections. The read and idle timeouts provide sufficient protection against slow clients.

- [ ] **Step 2: Build to verify**

```bash
cd api && go build ./...
```

Expected: no errors

- [ ] **Step 3: Manual smoke test**

```bash
# Start API locally
cd api && go run cmd/server/main.go &

# Test config endpoint (should return enabled:false for unknown slug)
curl -s "http://localhost:8080/api/v1/chat/config?slug=unknown" \
  -H "X-Forwarded-Host: localhost:3000" | jq .
```

Expected:
```json
{"data": {"enabled": false}, "status": "ok"}
```

- [ ] **Step 4: Commit**

```bash
git add api/internal/handler/router.go api/cmd/server/main.go
git commit -m "feat(api): register chat routes /api/v1/chat/config and /api/v1/chat/message"
```

---

### Task 5b: Add chat_enabled to model.Account + GetBySlug query

**Files:**
- Modify: `api/internal/model/account.go`
- Modify: `api/internal/store/account_store.go`

This step is required so that the public `GET /api/v1/accounts/slug/{slug}` endpoint returns `chat_enabled`, which the Next.js SSR page uses to decide whether to render `ChatButton`.

- [ ] **Step 1: Add field to model.Account**

In `api/internal/model/account.go`, add to `Account` struct after `IsPaid`:

```go
ChatEnabled bool `json:"chat_enabled" db:"chat_enabled"`
```

- [ ] **Step 2: Update GetBySlug SELECT query**

In `api/internal/store/account_store.go`, in the `GetBySlug` function, extend the SQL query:

```go
// Before:
SELECT id, platform, username, COALESCE(slug,''), COALESCE(display_name,''),
    COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(social_links, '{}')::text::bytea,
    is_paid, created_at
FROM accounts WHERE COALESCE(slug, username) = $1

// After:
SELECT id, platform, username, COALESCE(slug,''), COALESCE(display_name,''),
    COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(social_links, '{}')::text::bytea,
    is_paid, chat_enabled, created_at
FROM accounts WHERE COALESCE(slug, username) = $1
```

And extend the `.Scan()` call to include `&a.ChatEnabled` between `&a.IsPaid` and `&a.CreatedAt`.

- [ ] **Step 3: Build to verify**

```bash
cd api && go build ./...
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add api/internal/model/account.go api/internal/store/account_store.go
git commit -m "feat(model): add chat_enabled to Account model and GetBySlug query"
```

---

### Task 6: Extend admin store — UpdateAccountInput with chat fields

**Files:**
- Modify: `api/internal/store/admin_store.go`

- [ ] **Step 1: Write failing test**

Add to `api/internal/store/admin_store_test.go` (or create if not exists):

```go
func TestUpdateAccountInput_ChatFields(t *testing.T) {
    // Verify chat fields are present in UpdateAccountInput
    var input UpdateAccountInput
    chatEnabled := true
    prompt := "custom prompt"
    adText := "check my OF"

    input.ChatEnabled = &chatEnabled
    input.ChatPrompt = &prompt
    input.ChatAdText = &adText

    if input.ChatEnabled == nil || *input.ChatEnabled != true {
        t.Error("ChatEnabled field missing or wrong value")
    }
    if input.ChatPrompt == nil || *input.ChatPrompt != "custom prompt" {
        t.Error("ChatPrompt field missing or wrong value")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd api && go test ./internal/store/... -v -run TestUpdateAccountInput_ChatFields
```

Expected: FAIL (fields don't exist yet)

- [ ] **Step 3: Add chat fields to UpdateAccountInput and UpdateAccount**

In `api/internal/store/admin_store.go`, extend `UpdateAccountInput`:

```go
type UpdateAccountInput struct {
    IsActive    *bool              `json:"is_active,omitempty"`
    IsPaid      *bool              `json:"is_paid,omitempty"`
    SocialLinks *map[string]string `json:"social_links,omitempty"`
    ChatEnabled *bool              `json:"chat_enabled,omitempty"`
    ChatPrompt  *string            `json:"chat_prompt,omitempty"`
    ChatAdText  *string            `json:"chat_ad_text,omitempty"`
}
```

In `UpdateAccount()` method, add after the `SocialLinks` block:

```go
if input.ChatEnabled != nil {
    _, err := s.pool.Exec(ctx,
        `UPDATE accounts SET chat_enabled = $2, updated_at = NOW() WHERE id = $1`,
        id, *input.ChatEnabled,
    )
    if err != nil {
        return nil, fmt.Errorf("admin_store: update chat_enabled: %w", err)
    }
}
if input.ChatPrompt != nil {
    _, err := s.pool.Exec(ctx,
        `UPDATE accounts SET chat_prompt = NULLIF($2, ''), updated_at = NOW() WHERE id = $1`,
        id, *input.ChatPrompt,
    )
    if err != nil {
        return nil, fmt.Errorf("admin_store: update chat_prompt: %w", err)
    }
}
if input.ChatAdText != nil {
    _, err := s.pool.Exec(ctx,
        `UPDATE accounts SET chat_ad_text = NULLIF($2, ''), updated_at = NOW() WHERE id = $1`,
        id, *input.ChatAdText,
    )
    if err != nil {
        return nil, fmt.Errorf("admin_store: update chat_ad_text: %w", err)
    }
}
```

- [ ] **Step 4: Add chat fields to AdminAccount struct and getAccountByID query**

In `api/internal/store/admin_store.go`, find the `AdminAccount` struct and add:
```go
ChatEnabled bool    `json:"chat_enabled"`
ChatPrompt  *string `json:"chat_prompt"`
ChatAdText  *string `json:"chat_ad_text"`
```

In the `getAccountByID` SQL query (the SELECT used by `UpdateAccount` to return the updated row), add the three new columns to the SELECT list and corresponding Scan destinations. The exact location: search for `getAccountByID` in `admin_store.go` and extend the query and `Scan()` call.

- [ ] **Step 5: Build to verify compilation**

```bash
cd api && go build ./internal/store/...
```

Expected: no errors

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd api && go test ./internal/store/... -v -run TestUpdateAccountInput_ChatFields
cd api && go test ./... 2>&1 | tail -5
```

Expected: PASS, no compilation errors

- [ ] **Step 7: Commit**

```bash
git add api/internal/store/admin_store.go
git commit -m "feat(store): extend UpdateAccountInput and AdminAccount with chat fields"
```

---

### Task 7: Add chat event types to analytics

**Files:**
- Modify: `api/internal/handler/event.go`

- [ ] **Step 1: Add chat event types to validEventTypes map**

In `api/internal/handler/event.go`, add to `validEventTypes`:

```go
"chat_open":     true,
"chat_message":  true,
"chat_cta_click": true,
```

- [ ] **Step 2: Build to verify**

```bash
cd api && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/handler/event.go
git commit -m "feat(analytics): add chat_open, chat_message, chat_cta_click event types"
```

---

## Chunk 2: Frontend — Chat UI Components

### Task 8: Add chat_enabled to Account type + analytics event types and helpers

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/lib/analytics.ts`

- [ ] **Step 1: Add chat_enabled to Account interface and chat events to AnalyticsEventType**

In `web/src/types/index.ts`:

1. Add `chat_enabled?: boolean` to the `Account` interface (after `videos?`):
```typescript
  videos?: Video[];
  chat_enabled?: boolean;
```

2. Add chat event types to the `AnalyticsEventType` union. In `web/src/types/index.ts`, find the last line of the union (currently `| "content_click"`) and add three lines after it:
```typescript
  | "chat_open"
  | "chat_message"
  | "chat_cta_click";
```
Do not replace the entire union — only append these three lines.

- [ ] **Step 2: Add chat analytics helpers to analytics.ts**

In `web/src/lib/analytics.ts`, add at the end of the file:

```typescript
// Note: account_id is required by the Go event handler (event.go line 69).
// All three helpers must include it, otherwise the API returns 400 and events are silently lost.

export function trackChatOpen(slug: string, accountId: number): void {
  pushEvent({ type: "chat_open", account_id: accountId, source_page: `chat:${slug}` });
}

export function trackChatMessage(slug: string, accountId: number): void {
  pushEvent({ type: "chat_message", account_id: accountId, source_page: `chat:${slug}` });
}

export function trackChatCTAClick(slug: string, accountId: number, targetUrl: string): void {
  pushEvent({
    type: "chat_cta_click",
    account_id: accountId,
    target_url: targetUrl,
    source_page: `chat:${slug}`,
  });
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add web/src/types/index.ts web/src/lib/analytics.ts
git commit -m "feat(types): add chat_enabled to Account; add chat analytics event types and helpers"
```

---

### Task 9: chatHistory utility

**Files:**
- Create: `web/src/templates/default/chatHistory.ts`

- [ ] **Step 1: Write the utility**

Create `web/src/templates/default/chatHistory.ts`:

```typescript
"use client";

const MAX_MESSAGES = 50;
const CONTEXT_MESSAGES = 20;
const KEY_PREFIX = "chat_history_";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CTAData {
  text: string;
  url: string;
}

export interface ChatDisplayMessage extends ChatMessage {
  id: string;  // for React key
  cta?: CTAData;
}

function storageKey(slug: string): string {
  return KEY_PREFIX + slug;
}

export function createChatHistory(slug: string) {
  function getHistory(): ChatDisplayMessage[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(storageKey(slug));
      if (!raw) return [];
      return JSON.parse(raw) as ChatDisplayMessage[];
    } catch {
      return [];
    }
  }

  function addMessage(msg: ChatDisplayMessage): void {
    const history = getHistory();
    history.push(msg);
    // Trim to max
    const trimmed = history.slice(-MAX_MESSAGES);
    try {
      localStorage.setItem(storageKey(slug), JSON.stringify(trimmed));
    } catch {
      // localStorage full — clear history and drop this message
      localStorage.removeItem(storageKey(slug));
    }
  }

  function clearHistory(): void {
    try {
      localStorage.removeItem(storageKey(slug));
    } catch {
      // ignore
    }
  }

  // Returns last CONTEXT_MESSAGES as API-compatible messages (without id/cta)
  function getContextMessages(): ChatMessage[] {
    return getHistory()
      .slice(-CONTEXT_MESSAGES)
      .map(({ role, content }) => ({ role, content }));
  }

  return { getHistory, addMessage, clearHistory, getContextMessages };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/templates/default/chatHistory.ts
git commit -m "feat(chat): add chatHistory utility for localStorage persistence"
```

---

### Task 10: ChatScreen component

**Files:**
- Create: `web/src/templates/default/ChatScreen.tsx`

- [ ] **Step 1: Write ChatScreen**

Create `web/src/templates/default/ChatScreen.tsx`:

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createChatHistory, type ChatDisplayMessage, type CTAData } from "./chatHistory";
import { trackChatOpen, trackChatMessage, trackChatCTAClick } from "@/lib/analytics";

interface ChatScreenProps {
  slug: string;
  accountId: number;
  modelName: string;
  avatarUrl?: string;
  onClose: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function ChatScreen({ slug, accountId, modelName, avatarUrl, onClose }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { getHistory, addMessage, getContextMessages } = createChatHistory(slug);

  // Load history + greeting on mount
  useEffect(() => {
    const history = getHistory();
    if (history.length > 0) {
      setMessages(history);
    } else {
      // Fetch greeting
      fetchGreeting();
    }
    trackChatOpen(slug, accountId);
    inputRef.current?.focus();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchGreeting() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/config?slug=${encodeURIComponent(slug)}`);
      const json = await res.json();
      if (json.data?.greeting) {
        const greetMsg: ChatDisplayMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: json.data.greeting,
        };
        setMessages([greetMsg]);
        addMessage(greetMsg);
      }
    } catch {
      // No greeting — start with empty chat
    }
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);

    // Capture context BEFORE adding user message to history (avoid duplicate in Grok context)
    const contextHistory = getContextMessages();

    const userMsg: ChatDisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    addMessage(userMsg);

    // Track message sent
    trackChatMessage(slug, accountId);

    setStreaming(true);
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatDisplayMessage = { id: assistantId, role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_slug: slug,
          message: text,
          history: contextHistory,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let cta: CTAData | undefined;

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(`${modelName} is unavailable right now, try again later.`);
              reader.cancel();
              streamDone = true;
              break;
            }
            if (parsed.done) {
              if (parsed.cta) cta = parsed.cta as CTAData;
              streamDone = true;
              break;
            }
            if (parsed.delta) {
              fullContent += parsed.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                )
              );
            }
          } catch {
            // skip malformed SSE event
          }
        }
      }

      // Finalize assistant message with CTA if present
      const finalMsg: ChatDisplayMessage = {
        id: assistantId,
        role: "assistant",
        content: fullContent,
        cta,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? finalMsg : m))
      );
      addMessage(finalMsg);
    } catch {
      setError("Something went wrong. Please try again.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [input, streaming, messages, slug, accountId, getContextMessages, addMessage]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleCTAClick(cta: CTAData) {
    trackChatCTAClick(slug, accountId, cta.url);
    window.open(cta.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" style={{ maxWidth: 430, margin: "0 auto" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-elevated border-b border-border shrink-0">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-bg-card">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={modelName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-accent font-bold text-sm">
                {modelName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border border-bg-elevated" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-txt truncate">{modelName}</p>
          <p className="text-[11px] text-green-500">● online now</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-txt-muted hover:text-txt rounded-full hover:bg-bg-card transition-colors"
          aria-label="Close chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[80%] space-y-2">
              <div
                className={`px-3 py-2 rounded-2xl text-[13px] leading-[1.5] ${
                  msg.role === "user"
                    ? "bg-accent text-white rounded-br-sm"
                    : "bg-bg-elevated text-txt rounded-bl-sm border border-border"
                }`}
              >
                {msg.content || (streaming && msg.role === "assistant" && messages[messages.length - 1]?.id === msg.id ? (
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-txt-muted rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-txt-muted rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-txt-muted rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                ) : null)}
              </div>
              {msg.cta && (
                <button
                  onClick={() => handleCTAClick(msg.cta!)}
                  className="block w-full px-3 py-2 text-[12px] font-semibold text-accent border border-accent rounded-xl hover:bg-accent hover:text-white transition-colors text-left"
                >
                  {msg.cta.text} →
                </button>
              )}
            </div>
          </div>
        ))}
        {error && (
          <p className="text-center text-[12px] text-red-400 py-2">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 bg-bg-elevated border-t border-border shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${modelName}...`}
            rows={1}
            disabled={streaming}
            maxLength={1000}
            className="flex-1 bg-bg-card text-txt text-[13px] placeholder:text-txt-muted rounded-2xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent border border-border disabled:opacity-50"
            style={{ maxHeight: 80 }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="w-9 h-9 shrink-0 flex items-center justify-center bg-accent text-white rounded-full disabled:opacity-40 hover:bg-accent/90 transition-colors"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add web/src/templates/default/ChatScreen.tsx
git commit -m "feat(chat): add ChatScreen full-screen chat UI with SSE streaming"
```

---

### Task 11: ChatButton component + ProfileHeader integration

**Files:**
- Create: `web/src/templates/default/ChatButton.tsx`
- Modify: `web/src/templates/default/ProfileHeader.tsx`

- [ ] **Step 1: Create ChatButton**

Create `web/src/templates/default/ChatButton.tsx`:

```typescript
"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ChatScreen } from "./ChatScreen";
import type { Account } from "@/types";

interface ChatButtonProps {
  account: Account;
}

export function ChatButton({ account }: ChatButtonProps) {
  const [open, setOpen] = useState(false);

  if (!account.chat_enabled) return null;

  const slug = account.slug || account.username;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-accent text-white hover:bg-accent/90 transition-colors shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
        Chat
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <ChatScreen
          slug={slug}
          accountId={account.id}
          modelName={account.display_name || account.username}
          avatarUrl={account.avatar_url}
          onClose={() => setOpen(false)}
        />,
        document.body
      )}
    </>
  );
}
```

- [ ] **Step 2: Add ChatButton to ProfileHeader**

In `web/src/templates/default/ProfileHeader.tsx`, import and add `ChatButton`:

Add import at top:
```typescript
import { ChatButton } from "./ChatButton";
```

In the `ProfileHeader` component, add `<ChatButton account={account} />` in the top row div (after the name/stats section):

```typescript
// The top row currently is:
<div className="flex items-center gap-4">
  {/* avatar */}
  <div className="flex-1 min-w-0">
    {/* name, handle, video count */}
  </div>
</div>
```

Change to:
```typescript
<div className="flex items-center gap-4">
  {/* avatar */}
  <div className="flex-1 min-w-0">
    <div className="flex items-center gap-2">
      <p className="text-[16px] font-bold text-txt truncate">
        {displayName}
      </p>
      <ChatButton account={account} />
    </div>
    <p className="text-[13px] text-txt-muted">@{account.username}</p>
    <p className="text-[13px] text-txt-secondary mt-1">
      <span className="font-semibold text-txt">
        {account.video_count || 0}
      </span>{" "}
      video{(account.video_count || 0) !== 1 ? "s" : ""}
    </p>
  </div>
</div>
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Verify dev server renders without errors**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: successful build

- [ ] **Step 5: Commit**

```bash
git add web/src/templates/default/ChatButton.tsx web/src/templates/default/ProfileHeader.tsx
git commit -m "feat(chat): add ChatButton to ProfileHeader, wires up ChatScreen"
```

---

## Chunk 3: Admin Panel

### Task 12: Admin panel — Chat Settings section

**Files:**
- Modify: `web/src/lib/admin-api.ts`
- Modify: `web/src/app/admin/accounts/[id]/page.tsx`

- [ ] **Step 1: Extend admin-api.ts**

In `web/src/lib/admin-api.ts`:

1. Add chat fields to `AdminAccount` interface:
```typescript
export interface AdminAccount {
  // ... existing fields ...
  chat_enabled: boolean;
  chat_prompt: string | null;
  chat_ad_text: string | null;
}
```

2. Extend `updateAdminAccount` to accept chat fields:
```typescript
export async function updateAdminAccount(
  id: number,
  data: {
    is_active?: boolean;
    is_paid?: boolean;
    social_links?: Record<string, string>;
    chat_enabled?: boolean;
    chat_prompt?: string;
    chat_ad_text?: string;
  }
): Promise<AdminAccount> {
  // existing implementation stays the same — just add fields to the type
}
```

- [ ] **Step 2: Add Chat Settings tab to admin account page**

In `web/src/app/admin/accounts/[id]/page.tsx`:

1. Add `"chat"` to the `Tab` type:
```typescript
type Tab = "stats" | "links" | "promo" | "chat";
```

2. Add chat state:
```typescript
const [chatEnabled, setChatEnabled] = useState(false);
const [chatPrompt, setChatPrompt] = useState("");
const [chatAdText, setChatAdText] = useState("");
const [chatSaving, setChatSaving] = useState(false);
```

3. In `loadAccount`, after loading account data, initialize chat state:
```typescript
// Use `data` (local variable), NOT `account` (state — not yet updated at this point)
setChatEnabled(data.chat_enabled ?? false);
setChatPrompt(data.chat_prompt ?? "");
setChatAdText(data.chat_ad_text ?? "");
```

4. Add save handler:
```typescript
const saveChatSettings = useCallback(async () => {
  if (!account) return;
  setChatSaving(true);
  try {
    await updateAdminAccount(id, {
      chat_enabled: chatEnabled,
      chat_prompt: chatPrompt,
      chat_ad_text: chatAdText,
    });
    toast("Chat settings saved", "success");
  } catch {
    toast("Failed to save chat settings", "error");
  } finally {
    setChatSaving(false);
  }
}, [id, account, chatEnabled, chatPrompt, chatAdText, toast]);
```

5. Add "Chat" tab button in the tab bar (alongside stats, links, promo).

6. Add the Chat tab content panel:
```tsx
{activeTab === "chat" && (
  <div className="space-y-4 p-4">
    <h3 className="text-sm font-semibold text-txt uppercase tracking-wide">Chat Settings</h3>

    {/* Toggle */}
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-txt">Chat enabled</p>
        <p className="text-xs text-txt-muted">Show "Chat" button on profile page</p>
      </div>
      <button
        onClick={() => setChatEnabled(!chatEnabled)}
        className={`w-10 h-6 rounded-full transition-colors ${chatEnabled ? "bg-accent" : "bg-bg-card border border-border"}`}
      >
        <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${chatEnabled ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>

    {/* Custom prompt */}
    <div>
      <label className="block text-xs font-medium text-txt-muted mb-1">
        Custom prompt (optional)
      </label>
      <textarea
        value={chatPrompt}
        onChange={(e) => setChatPrompt(e.target.value)}
        maxLength={2000}
        rows={6}
        placeholder="Leave empty to auto-generate from model data"
        className="w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
      />
      <p className="text-xs text-txt-muted mt-1">{chatPrompt.length}/2000</p>
    </div>

    {/* Ad message */}
    <div>
      <label className="block text-xs font-medium text-txt-muted mb-1">
        Ad message (optional)
      </label>
      <textarea
        value={chatAdText}
        onChange={(e) => setChatAdText(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Leave empty — agent will use model's social links"
        className="w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
      />
      <p className="text-xs text-txt-muted mt-1">{chatAdText.length}/500</p>
    </div>

    <button
      onClick={saveChatSettings}
      disabled={chatSaving}
      className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-accent/90 transition-colors"
    >
      {chatSaving ? "Saving..." : "Save Chat Settings"}
    </button>
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Fix any errors.

- [ ] **Step 4: Verify build**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: successful build

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/admin-api.ts web/src/app/admin/accounts/[id]/page.tsx
git commit -m "feat(admin): add Chat Settings tab to account edit page"
```

---

## Final Verification

- [ ] **Run all Go tests**

```bash
cd api && go test ./... 2>&1 | tail -20
```

Expected: all pass

- [ ] **Run Next.js build**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: successful build, no type errors

- [ ] **End-to-end smoke test (local)**

1. Apply migration 017 to local DB
2. Add `XAI_API_KEY=<key>` to local `.env`
3. Start API: `cd api && go run cmd/server/main.go`
4. Start web: `cd web && npm run dev`
5. In admin panel, enable chat for a test model
6. Visit `/model/<slug>` — verify "💬 Chat" button appears in header
7. Click Chat → verify ChatScreen opens full-screen
8. Send a message → verify streaming response appears
9. Verify history persists after closing and reopening chat
10. Verify CTA card renders when agent includes a link

- [ ] **Commit final state**

```bash
git add -A
git commit -m "feat: AI chat widget with Grok SSE streaming (complete)"
```
