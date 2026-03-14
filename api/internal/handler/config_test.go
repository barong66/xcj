package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xcj/videosite-api/internal/handler"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
)

func TestConfigHandler_GetSiteConfig(t *testing.T) {
	h := handler.NewConfigHandler()

	t.Run("returns site config", func(t *testing.T) {
		site := &model.Site{
			ID:     1,
			Domain: "temptguide.com",
			Name:   "TemptGuide",
			Config: json.RawMessage(`{"template":"default"}`),
		}

		req := httptest.NewRequest("GET", "/api/v1/config", nil)
		req = req.WithContext(middleware.WithSite(req.Context(), site))
		w := httptest.NewRecorder()

		h.GetSiteConfig(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp map[string]interface{}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if resp["status"] != "ok" {
			t.Errorf("expected status ok, got %v", resp["status"])
		}
		data, ok := resp["data"].(map[string]interface{})
		if !ok {
			t.Fatalf("expected data to be a map, got %T", resp["data"])
		}
		if data["domain"] != "temptguide.com" {
			t.Errorf("expected domain temptguide.com, got %v", data["domain"])
		}
		if data["name"] != "TemptGuide" {
			t.Errorf("expected name TemptGuide, got %v", data["name"])
		}
	})

	t.Run("returns 404 when site not in context", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/v1/config", nil)
		w := httptest.NewRecorder()

		h.GetSiteConfig(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}
