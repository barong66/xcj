package handler

import (
	"log/slog"
	"net/http"
)

// DashboardSiteItem holds per-site summary data for the admin dashboard.
type DashboardSiteItem struct {
	ID            int     `json:"id"`
	Domain        string  `json:"domain"`
	Name          string  `json:"name"`
	IsActive      bool    `json:"is_active"`
	VideoCount    int     `json:"video_count"`
	CategoryCount int     `json:"category_count"`
	Sessions7d    int64   `json:"sessions_7d"`
	Conversions7d int64   `json:"conversions_7d"`
	CTR           float64 `json:"ctr"`
}

// AdminDashboardSites handles GET /api/v1/admin/dashboard/sites.
// Returns all sites with their 7-day traffic stats from ClickHouse.
func (h *AdminHandler) AdminDashboardSites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	sites, err := h.admin.ListSites(ctx)
	if err != nil {
		slog.Error("admin dashboard: list sites", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list sites")
		return
	}

	items := make([]DashboardSiteItem, 0, len(sites))
	for _, s := range sites {
		item := DashboardSiteItem{
			ID:            int(s.ID),
			Domain:        s.Domain,
			Name:          s.Name,
			IsActive:      s.IsActive,
			VideoCount:    int(s.VideoCount),
			CategoryCount: int(s.CategoryCount),
		}

		traffic, err := h.ch.GetSiteTrafficStats(ctx, s.ID)
		if err != nil {
			slog.Error("admin dashboard: site traffic stats", "error", err, "site_id", s.ID)
			// Non-fatal: continue with zero traffic stats for this site.
		} else {
			item.Sessions7d = traffic.Sessions7d
			item.Conversions7d = traffic.Conversions7d
			item.CTR = traffic.CTR
		}

		items = append(items, item)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"sites": items})
}
