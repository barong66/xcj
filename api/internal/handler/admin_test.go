package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/model"
	s3client "github.com/xcj/videosite-api/internal/s3"
)

func TestEnrichEvent_ParsesQueryParams(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/b/serve?sw=1920&sh=1080&vw=1200&vh=800&lang=en-US&ct=4g&pu=https%3A%2F%2Fexample.com&utm_source=google&utm_medium=cpc&utm_campaign=test", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	var ev model.Event
	enrichEvent(&ev, req)

	if ev.Browser != "Chrome" {
		t.Errorf("Browser = %q, want Chrome", ev.Browser)
	}
	if ev.DeviceType != "desktop" {
		t.Errorf("DeviceType = %q, want desktop", ev.DeviceType)
	}
	if ev.ScreenWidth != 1920 {
		t.Errorf("ScreenWidth = %d, want 1920", ev.ScreenWidth)
	}
	if ev.ViewportWidth != 1200 {
		t.Errorf("ViewportWidth = %d, want 1200", ev.ViewportWidth)
	}
	if ev.Language != "en-US" {
		t.Errorf("Language = %q, want en-US", ev.Language)
	}
	if ev.ConnectionType != "4g" {
		t.Errorf("ConnectionType = %q, want 4g", ev.ConnectionType)
	}
	if ev.UTMSource != "google" {
		t.Errorf("UTMSource = %q, want google", ev.UTMSource)
	}
}

func TestHandlePerfBeacon_NoBannerID(t *testing.T) {
	h := &BannerHandler{}

	req := httptest.NewRequest(http.MethodGet, "/b/perf", nil)
	rr := httptest.NewRecorder()
	h.HandlePerfBeacon(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	ct := rr.Header().Get("Content-Type")
	if ct != "image/gif" {
		t.Errorf("Content-Type = %q, want image/gif", ct)
	}
}

func TestAdminAuth(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	middleware := AdminAuth("test-secret-123")
	handler := middleware(inner)

	tests := []struct {
		name       string
		authHeader string
		wantStatus int
	}{
		{"valid token", "Bearer test-secret-123", http.StatusOK},
		{"wrong token", "Bearer wrong-token", http.StatusUnauthorized},
		{"missing header", "", http.StatusUnauthorized},
		{"no bearer prefix", "test-secret-123", http.StatusUnauthorized},
		{"basic auth instead", "Basic dGVzdDp0ZXN0", http.StatusUnauthorized},
		{"bearer lowercase", "bearer test-secret-123", http.StatusOK},
		{"extra spaces in token", "Bearer  test-secret-123", http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/admin/test", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
		})
	}
}

func TestDeactivateBanner_InvalidID(t *testing.T) {
	// Handler with nil admin store — we expect it to fail on ID parsing
	// before reaching the store call.
	h := &AdminHandler{}

	tests := []struct {
		name       string
		idParam    string
		wantStatus int
	}{
		{"non-numeric id", "abc", http.StatusBadRequest},
		{"empty id", "", http.StatusBadRequest},
		{"float id", "1.5", http.StatusBadRequest},
		{"overflow", "99999999999999999999", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/admin/banners/"+tt.idParam, nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tt.idParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			rr := httptest.NewRecorder()
			h.DeactivateBanner(rr, req)
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
		})
	}
}

func TestGetAccountStats_InvalidID(t *testing.T) {
	h := &AdminHandler{}

	tests := []struct {
		name       string
		idParam    string
		wantStatus int
	}{
		{"non-numeric id", "abc", http.StatusBadRequest},
		{"empty id", "", http.StatusBadRequest},
		{"float id", "1.5", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/admin/accounts/"+tt.idParam+"/stats", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tt.idParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			rr := httptest.NewRecorder()
			h.GetAccountStats(rr, req)
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
		})
	}
}

func TestDeleteAccount_InvalidID(t *testing.T) {
	h := &AdminHandler{}

	tests := []struct {
		name       string
		idParam    string
		wantStatus int
	}{
		{"non-numeric id", "abc", http.StatusBadRequest},
		{"empty id", "", http.StatusBadRequest},
		{"float id", "3.14", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/admin/accounts/"+tt.idParam, nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tt.idParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			rr := httptest.NewRecorder()
			h.DeleteAccount(rr, req)
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
		})
	}
}

// newDummyS3 creates an S3 client with fake credentials for testing.
// minio.New doesn't connect during construction, so this is safe.
func newDummyS3(t *testing.T) *s3client.Client {
	t.Helper()
	c, err := s3client.NewClient("https://fake.r2.dev", "key", "secret", "auto", "bucket", "https://media.example.com")
	if err != nil {
		t.Fatalf("newDummyS3: %v", err)
	}
	return c
}

func TestRecropBanner_NoS3(t *testing.T) {
	h := &AdminHandler{} // s3 is nil

	req := httptest.NewRequest(http.MethodPost, "/admin/banners/1/recrop",
		strings.NewReader(`{"x":0,"y":0,"width":100,"height":100}`))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.RecropBanner(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusServiceUnavailable)
	}
}

func TestRecropBanner_InvalidID(t *testing.T) {
	h := &AdminHandler{s3: newDummyS3(t)}

	tests := []struct {
		name       string
		idParam    string
		wantStatus int
	}{
		{"non-numeric id", "abc", http.StatusBadRequest},
		{"empty id", "", http.StatusBadRequest},
		{"float id", "1.5", http.StatusBadRequest},
		{"overflow", "99999999999999999999", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/admin/banners/"+tt.idParam+"/recrop",
				strings.NewReader(`{"x":0,"y":0,"width":100,"height":100}`))
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tt.idParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			rr := httptest.NewRecorder()
			h.RecropBanner(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d", rr.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestRecropBanner_InvalidBody(t *testing.T) {
	h := &AdminHandler{s3: newDummyS3(t)}

	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{"empty body", "", http.StatusBadRequest},
		{"not json", "not-json", http.StatusBadRequest},
		{"zero width", `{"x":0,"y":0,"width":0,"height":100}`, http.StatusBadRequest},
		{"negative height", `{"x":0,"y":0,"width":100,"height":-1}`, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/admin/banners/1/recrop",
				strings.NewReader(tt.body))
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", "1")
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			rr := httptest.NewRecorder()
			h.RecropBanner(rr, req)
			if rr.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
		})
	}
}
