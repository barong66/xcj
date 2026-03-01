package model

import "time"

type Account struct {
	ID          int64             `json:"id" db:"id"`
	Platform    string            `json:"platform" db:"platform"`
	Username    string            `json:"username" db:"username"`
	Slug        string            `json:"slug" db:"slug"`
	DisplayName string            `json:"display_name" db:"display_name"`
	AvatarURL   string            `json:"avatar_url" db:"avatar_url"`
	Bio         string            `json:"bio,omitempty" db:"bio"`
	SocialLinks map[string]string `json:"social_links,omitempty" db:"social_links"`
	IsPaid      bool              `json:"is_paid" db:"is_paid"`
	CreatedAt   time.Time         `json:"created_at" db:"created_at"`

	// Joined fields
	Videos     []Video `json:"videos,omitempty"`
	VideoCount int64   `json:"video_count,omitempty"`
}
