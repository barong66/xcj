package handler

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

// withMockSite injects a fake site into the request context.
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
