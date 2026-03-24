package handler

import (
	"net/http"
	"net/url"
	"testing"
)

func TestIntParam_TopCategories(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		fallback int
		want     int
	}{
		{"valid positive",    "top_categories=3",   0, 3},
		{"valid large",       "top_categories=10",  0, 10},
		{"zero → fallback",   "top_categories=0",   0, 0},
		{"negative → fallback", "top_categories=-1", 0, 0},
		{"non-numeric → fallback", "top_categories=abc", 0, 0},
		{"missing → fallback", "", 0, 0},
		{"other params ignored", "page=2&top_categories=5", 0, 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{URL: &url.URL{RawQuery: tt.query}}
			got := intParam(r, "top_categories", tt.fallback)
			if got != tt.want {
				t.Errorf("intParam(top_categories) = %d, want %d", got, tt.want)
			}
		})
	}
}
