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
