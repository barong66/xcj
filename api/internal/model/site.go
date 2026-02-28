package model

import (
	"encoding/json"
	"time"
)

type Site struct {
	ID        int64           `json:"id" db:"id"`
	Slug      string          `json:"slug" db:"slug"`
	Domain    string          `json:"domain" db:"domain"`
	Name      string          `json:"name" db:"name"`
	Config    json.RawMessage `json:"config" db:"config"`
	IsActive  bool            `json:"is_active" db:"is_active"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt time.Time       `json:"updated_at" db:"updated_at"`
}
