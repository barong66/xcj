package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAdminAuth(t *testing.T) {
	// Set up a known admin token.
	t.Setenv("ADMIN_TOKEN", "test-secret-123")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := AdminAuth(inner)

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

func TestAdminAuth_DefaultToken(t *testing.T) {
	// When ADMIN_TOKEN is not set, it falls back to default.
	t.Setenv("ADMIN_TOKEN", "")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := AdminAuth(inner)

	req := httptest.NewRequest(http.MethodGet, "/admin/test", nil)
	req.Header.Set("Authorization", "Bearer xcj-admin-2024")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("default token: status = %d, want %d", rr.Code, http.StatusOK)
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
