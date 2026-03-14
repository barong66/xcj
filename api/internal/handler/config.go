package handler

import (
	"net/http"

	"github.com/xcj/videosite-api/internal/middleware"
)

type ConfigHandler struct{}

func NewConfigHandler() *ConfigHandler {
	return &ConfigHandler{}
}

// GetSiteConfig returns public site configuration for the current domain.
// Used by Next.js SSR to determine template and site settings.
func (h *ConfigHandler) GetSiteConfig(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusNotFound, "site not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"data": map[string]interface{}{
			"domain": site.Domain,
			"name":   site.Name,
			"config": site.Config,
		},
	})
}
