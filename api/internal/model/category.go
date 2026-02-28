package model

type Category struct {
	ID        int64  `json:"id" db:"id"`
	Slug      string `json:"slug" db:"slug"`
	Name      string `json:"name" db:"name"`
	ParentID  *int64 `json:"parent_id,omitempty" db:"parent_id"`
	IsActive  bool   `json:"is_active" db:"is_active"`
	SortOrder int    `json:"sort_order" db:"sort_order"`

	// Computed fields
	VideoCount int64 `json:"video_count,omitempty"`
}

type SiteCategory struct {
	SiteID     int64 `json:"site_id" db:"site_id"`
	CategoryID int64 `json:"category_id" db:"category_id"`
}
