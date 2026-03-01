package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
)

type EventHandler struct {
	buffer *clickhouse.EventBuffer
}

func NewEventHandler(buffer *clickhouse.EventBuffer) *EventHandler {
	return &EventHandler{buffer: buffer}
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

	event := model.Event{
		SiteID:     site.ID,
		VideoID:    input.VideoID,
		AccountID:  input.AccountID,
		Type:       input.Type,
		SessionID:  input.SessionID,
		UserAgent:  r.UserAgent(),
		IP:         ip,
		Referrer:   input.Referrer,
		Extra:      input.Extra,
		TargetURL:  input.TargetURL,
		SourcePage: input.SourcePage,
		Source:     input.Source,
		CreatedAt:  time.Now().UTC(),
	}

	h.buffer.Push(event)

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
	ua := r.UserAgent()
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
			UserAgent:  ua,
			IP:         ip,
			Referrer:   input.Referrer,
			Extra:      input.Extra,
			TargetURL:  input.TargetURL,
			SourcePage: input.SourcePage,
			Source:     input.Source,
			CreatedAt:  now,
		}
		h.buffer.Push(event)
		accepted++
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"status":   "accepted",
		"accepted": accepted,
		"total":    len(inputs),
	})
}
