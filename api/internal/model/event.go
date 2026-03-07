package model

import "time"

// Event represents an analytics event sent from the frontend.
type Event struct {
	SiteID     int64     `json:"site_id"`
	VideoID    int64     `json:"video_id"`
	AccountID  int64     `json:"account_id"`
	Type       string    `json:"type"`
	SessionID  string    `json:"session_id"`
	UserAgent  string    `json:"user_agent"`
	IP         string    `json:"ip"`
	Referrer   string    `json:"referrer"`
	Extra      string    `json:"extra,omitempty"`
	TargetURL  string    `json:"target_url,omitempty"`
	SourcePage string    `json:"source_page,omitempty"`
	Source     string    `json:"source,omitempty"`
	CreatedAt  time.Time `json:"created_at"`

	// Parsed from user-agent.
	Browser    string `json:"browser,omitempty"`
	OS         string `json:"os,omitempty"`
	DeviceType string `json:"device_type,omitempty"`

	// Client context.
	ScreenWidth    int    `json:"screen_width,omitempty"`
	ScreenHeight   int    `json:"screen_height,omitempty"`
	ViewportWidth  int    `json:"viewport_width,omitempty"`
	ViewportHeight int    `json:"viewport_height,omitempty"`
	Language       string `json:"language,omitempty"`
	ConnectionType string `json:"connection_type,omitempty"`
	PageURL        string `json:"page_url,omitempty"`
	Country        string `json:"country,omitempty"`

	// UTM parameters.
	UTMSource   string `json:"utm_source,omitempty"`
	UTMMedium   string `json:"utm_medium,omitempty"`
	UTMCampaign string `json:"utm_campaign,omitempty"`
}

// PerfEvent holds banner performance metrics from the client.
type PerfEvent struct {
	BannerID        int64
	VideoID         int64
	AccountID       int64
	SiteID          int64
	ImageLoadMs     int
	RenderMs        int
	TimeToVisibleMs int
	DwellTimeMs     int
	HoverDurationMs int
	IsViewable      bool
	Browser         string
	OS              string
	DeviceType      string
	ScreenWidth     int
	ScreenHeight    int
	ConnectionType  string
	Country         string
}

// EventInput is what the client sends in POST /api/v1/events.
type EventInput struct {
	VideoID    int64  `json:"video_id"`
	AccountID  int64  `json:"account_id"`
	Type       string `json:"type" validate:"required"`
	SessionID  string `json:"session_id"`
	Referrer   string `json:"referrer"`
	Extra      string `json:"extra,omitempty"`
	TargetURL  string `json:"target_url,omitempty"`
	SourcePage string `json:"source_page,omitempty"`
	Source     string `json:"source,omitempty"`
}
