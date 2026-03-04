package model

import (
	"time"
)

type Video struct {
	ID              int64      `json:"id" db:"id"`
	AccountID       int64      `json:"account_id" db:"account_id"`
	Platform        string     `json:"platform" db:"platform"`
	PlatformID      string     `json:"platform_id" db:"platform_id"`
	OriginalURL     string     `json:"original_url" db:"original_url"`
	Title           string     `json:"title" db:"title"`
	Description     string     `json:"description" db:"description"`
	DurationSec     int        `json:"duration_sec" db:"duration_sec"`
	ThumbnailURL    string     `json:"thumbnail_url" db:"thumbnail_url"`
	PreviewURL      string     `json:"preview_url" db:"preview_url"`
	Width           int        `json:"width" db:"width"`
	Height          int        `json:"height" db:"height"`
	CountryID       *int64     `json:"country_id,omitempty" db:"country_id"`
	ViewCount       int64      `json:"view_count" db:"view_count"`
	ClickCount      int64      `json:"click_count" db:"click_count"`
	IsActive        bool       `json:"is_active" db:"is_active"`
	IsPromoted      bool       `json:"is_promoted" db:"is_promoted"`
	PromotedUntil   *time.Time `json:"promoted_until,omitempty" db:"promoted_until"`
	PromotionWeight float64    `json:"promotion_weight" db:"promotion_weight"`
	PublishedAt     *time.Time `json:"published_at,omitempty" db:"published_at"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`

	// Joined fields
	Categories []VideoCategory `json:"categories,omitempty"`
	Account    *Account        `json:"account,omitempty"`
}

type VideoCategory struct {
	CategoryID int64   `json:"category_id" db:"category_id"`
	Slug       string  `json:"slug" db:"slug"`
	Name       string  `json:"name" db:"name"`
	Confidence float64 `json:"confidence" db:"confidence"`
}

type SiteVideo struct {
	SiteID     int64     `json:"site_id" db:"site_id"`
	VideoID    int64     `json:"video_id" db:"video_id"`
	IsFeatured bool      `json:"is_featured" db:"is_featured"`
	AddedAt    time.Time `json:"added_at" db:"added_at"`
}

type VideoListParams struct {
	SiteID           int64
	CategoryID       *int64
	CountryID        *int64
	ExcludeAccountID *int64
	Sort             string // recent, popular, random, promoted
	Page             int
	PerPage          int
	Search           string
	AnchorSlug       string
	Source           string
}

type VideoListResult struct {
	Videos     []Video `json:"videos"`
	Total      int64   `json:"total"`
	Page       int     `json:"page"`
	PerPage    int     `json:"per_page"`
	TotalPages int     `json:"pages"`
}
