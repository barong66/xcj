package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type contextKey string

const siteContextKey contextKey = "site"

// SiteFromContext retrieves the current Site from the request context.
func SiteFromContext(ctx context.Context) *model.Site {
	site, _ := ctx.Value(siteContextKey).(*model.Site)
	return site
}

// SiteDetection is middleware that resolves the current site from the Host header
// or X-Site-Id header, and injects it into the request context.
func SiteDetection(siteStore *store.SiteStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var site *model.Site
			var err error

			// First, check X-Site-Id header for explicit site ID.
			if siteIDStr := r.Header.Get("X-Site-Id"); siteIDStr != "" {
				siteID, parseErr := strconv.ParseInt(siteIDStr, 10, 64)
				if parseErr == nil {
					site, err = siteStore.GetByID(r.Context(), siteID)
				}
			}

			// Fall back to domain detection via X-Forwarded-Host or Host header.
			if site == nil {
				host := r.Header.Get("X-Forwarded-Host")
				if host == "" {
					host = r.Host
				}
				// Strip port if present.
				if idx := strings.LastIndex(host, ":"); idx != -1 {
					host = host[:idx]
				}
				site, err = siteStore.GetByDomain(r.Context(), host)
			}

			if err != nil {
				slog.Error("failed to resolve site", "error", err, "host", r.Host)
				http.Error(w, `{"error":"site not found"}`, http.StatusNotFound)
				return
			}

			if site == nil {
				http.Error(w, `{"error":"site not found"}`, http.StatusNotFound)
				return
			}

			if !site.IsActive {
				http.Error(w, `{"error":"site is inactive"}`, http.StatusForbidden)
				return
			}

			ctx := context.WithValue(r.Context(), siteContextKey, site)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
