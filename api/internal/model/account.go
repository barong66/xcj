package model

import "time"

type Account struct {
	ID          int64     `json:"id" db:"id"`
	Platform    string    `json:"platform" db:"platform"`
	Username    string    `json:"username" db:"username"`
	DisplayName string    `json:"display_name" db:"display_name"`
	AvatarURL   string    `json:"avatar_url" db:"avatar_url"`
	IsPaid      bool      `json:"is_paid" db:"is_paid"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`

	// Joined fields
	Videos     []Video `json:"videos,omitempty"`
	VideoCount int64   `json:"video_count,omitempty"`
}
