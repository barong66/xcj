package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type EventHandler struct {
	buffer *clickhouse.EventBuffer
	admin  *store.AdminStore
}

func NewEventHandler(buffer *clickhouse.EventBuffer, admin *store.AdminStore) *EventHandler {
	return &EventHandler{buffer: buffer, admin: admin}
}

// validEventTypes defines the allowed event type values.
var validEventTypes = map[string]bool{
	"view":                     true,
	"click":                    true,
	"hover":                    true,
	"impression":               true,
	"feed_impression":          true,
	"feed_click":               true,
	"profile_view":             true,
	"profile_thumb_impression": true,
	"profile_thumb_click":      true,
	"social_click":             true,
	"share_click":              true,
	"ad_landing":               true,
	"banner_impression":        true,
	"banner_click":             true,
	"banner_hover":             true,
	"content_click":            true,
}

// conversionEventTypes are events that trigger ad network postbacks.
var conversionEventTypes = map[string]bool{
	"social_click":  true,
	"content_click": true,
}

// Create handles POST /api/v1/events
func (h *EventHandler) Create(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	var input model.EventInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.VideoID == 0 && input.AccountID == 0 {
		writeError(w, http.StatusBadRequest, "video_id or account_id is required")
		return
	}

	if !validEventTypes[input.Type] {
		writeError(w, http.StatusBadRequest, "invalid event type")
		return
	}

	// Extract client IP.
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the chain.
		parts := strings.SplitN(xff, ",", 2)
		ip = strings.TrimSpace(parts[0])
	}

	uaRaw := r.UserAgent()
	ua := ParseUA(uaRaw)
	country := r.Header.Get("CF-IPCountry")

	event := model.Event{
		SiteID:     site.ID,
		VideoID:    input.VideoID,
		AccountID:  input.AccountID,
		Type:       input.Type,
		SessionID:  input.SessionID,
		UserAgent:  uaRaw,
		IP:         ip,
		Referrer:   input.Referrer,
		Extra:      input.Extra,
		TargetURL:  input.TargetURL,
		SourcePage: input.SourcePage,
		Source:     input.Source,
		Browser:    ua.Browser,
		OS:         ua.OS,
		DeviceType: ua.DeviceType,
		Country:    country,
		CreatedAt:  time.Now().UTC(),
	}

	h.buffer.Push(event)

	// Fire conversion postback if applicable.
	if conversionEventTypes[event.Type] && event.Source != "" {
		go h.firePostbackIfConfigured(event)
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

// CreateBatch handles POST /api/v1/events/batch — accepts an array of events.
func (h *EventHandler) CreateBatch(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	var inputs []model.EventInput
	if err := json.NewDecoder(r.Body).Decode(&inputs); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(inputs) == 0 {
		writeError(w, http.StatusBadRequest, "at least one event is required")
		return
	}

	if len(inputs) > 100 {
		writeError(w, http.StatusBadRequest, "maximum 100 events per batch")
		return
	}

	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		ip = strings.TrimSpace(parts[0])
	}
	uaRaw := r.UserAgent()
	ua := ParseUA(uaRaw)
	country := r.Header.Get("CF-IPCountry")
	now := time.Now().UTC()

	accepted := 0
	for _, input := range inputs {
		if (input.VideoID == 0 && input.AccountID == 0) || !validEventTypes[input.Type] {
			continue
		}

		event := model.Event{
			SiteID:     site.ID,
			VideoID:    input.VideoID,
			AccountID:  input.AccountID,
			Type:       input.Type,
			SessionID:  input.SessionID,
			UserAgent:  uaRaw,
			IP:         ip,
			Referrer:   input.Referrer,
			Extra:      input.Extra,
			TargetURL:  input.TargetURL,
			SourcePage: input.SourcePage,
			Source:     input.Source,
			Browser:    ua.Browser,
			OS:         ua.OS,
			DeviceType: ua.DeviceType,
			Country:    country,
			CreatedAt:  now,
		}
		h.buffer.Push(event)
		accepted++

		// Fire conversion postback if applicable.
		if conversionEventTypes[event.Type] && event.Source != "" {
			go h.firePostbackIfConfigured(event)
		}
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"status":   "accepted",
		"accepted": accepted,
		"total":    len(inputs),
	})
}

// extractClickID extracts the click_id from the event's Extra JSON field.
func extractClickID(extra string) string {
	if extra == "" {
		return ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(extra), &data); err != nil {
		return ""
	}
	if clickID, ok := data["click_id"].(string); ok {
		return clickID
	}
	return ""
}

// firePostbackIfConfigured checks if the event's source has a configured postback URL
// and fires it asynchronously.
func (h *EventHandler) firePostbackIfConfigured(event model.Event) {
	clickID := extractClickID(event.Extra)
	if clickID == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	adSource, err := h.admin.GetAdSourceByName(ctx, event.Source)
	if err != nil || adSource == nil || adSource.PostbackURL == "" {
		return
	}

	// Look up CPA price for this account + event type.
	cpaPrice, _ := h.admin.GetConversionPrice(ctx, event.AccountID, event.Type)
	cpaStr := "0"
	if cpaPrice > 0 {
		cpaStr = strconv.FormatFloat(cpaPrice, 'f', -1, 64)
	}

	// Build postback URL from template.
	postbackURL := strings.ReplaceAll(adSource.PostbackURL, "{click_id}", url.QueryEscape(clickID))
	postbackURL = strings.ReplaceAll(postbackURL, "{event}", url.QueryEscape(event.Type))
	postbackURL = strings.ReplaceAll(postbackURL, "{cpa}", url.QueryEscape(cpaStr))

	// Create postback record.
	pb := &store.ConversionPostback{
		AdSourceID: adSource.ID,
		ClickID:    clickID,
		EventType:  event.Type,
		AccountID:  event.AccountID,
		VideoID:    event.VideoID,
		Status:     "pending",
		CpaAmount:  &cpaPrice,
	}
	if err := h.admin.CreateConversionPostback(ctx, pb); err != nil {
		slog.Error("postback: create record", "error", err)
		return
	}

	// Fire HTTP request.
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(postbackURL)
	if err != nil {
		h.admin.UpdatePostbackStatus(ctx, pb.ID, "failed", 0, err.Error())
		slog.Error("postback: request failed", "error", err, "url", postbackURL)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	status := "sent"
	if resp.StatusCode >= 400 {
		status = "failed"
	}
	h.admin.UpdatePostbackStatus(ctx, pb.ID, status, resp.StatusCode, string(body))
	slog.Info("postback: fired", "source", event.Source, "click_id", clickID, "event", event.Type, "status", status, "code", resp.StatusCode)
}
