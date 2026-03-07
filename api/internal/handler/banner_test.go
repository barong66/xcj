package handler

import (
	"bytes"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestParseBannerSize(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		wantW  int
		wantH  int
	}{
		{"size param", "size=300x250", 300, 250},
		{"w and h params", "w=728&h=90", 728, 90},
		{"size takes precedence", "size=300x250&w=728&h=90", 300, 250},
		{"missing size", "", 0, 0},
		{"invalid size", "size=abc", 0, 0},
		{"partial size", "size=300x", 300, 0},
		{"only width", "w=300", 300, 0},
		{"only height", "h=250", 0, 250},
		{"negative values", "w=-100&h=250", -100, 250},
		{"large values", "size=1920x1080", 1920, 1080},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{URL: &url.URL{RawQuery: tt.query}}
			w, h := parseBannerSize(r)
			if w != tt.wantW || h != tt.wantH {
				t.Errorf("parseBannerSize() = (%d, %d), want (%d, %d)", w, h, tt.wantW, tt.wantH)
			}
		})
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name       string
		xff        string
		remoteAddr string
		want       string
	}{
		{"xff single IP", "1.2.3.4", "5.6.7.8:1234", "1.2.3.4"},
		{"xff multiple IPs", "1.2.3.4, 10.0.0.1, 192.168.1.1", "5.6.7.8:1234", "1.2.3.4"},
		{"xff with spaces", "  1.2.3.4  , 10.0.0.1", "5.6.7.8:1234", "1.2.3.4"},
		{"no xff", "", "5.6.7.8:1234", "5.6.7.8:1234"},
		{"empty xff", "", "127.0.0.1:80", "127.0.0.1:80"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{
				Header:     http.Header{},
				RemoteAddr: tt.remoteAddr,
			}
			if tt.xff != "" {
				r.Header.Set("X-Forwarded-For", tt.xff)
			}
			got := clientIP(r)
			if got != tt.want {
				t.Errorf("clientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBannerExtra(t *testing.T) {
	tests := []struct {
		name     string
		bannerID int64
		clickID  string
		want     string
	}{
		{"with click_id", 42, "abc123", `{"banner_id":42,"click_id":"abc123"}`},
		{"without click_id", 42, "", `{"banner_id":42}`},
		{"zero banner id", 0, "xyz", `{"banner_id":0,"click_id":"xyz"}`},
		{"special chars in click_id", 10, `a"b`, `{"banner_id":10,"click_id":"a\"b"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := bannerExtra(tt.bannerID, tt.clickID)
			if got != tt.want {
				t.Errorf("bannerExtra(%d, %q) = %q, want %q", tt.bannerID, tt.clickID, got, tt.want)
			}
		})
	}
}

func TestPickBannerStyle(t *testing.T) {
	// Known styles return the correct template.
	for _, style := range bannerStyles {
		tmpl := pickBannerStyle(style)
		if tmpl == nil {
			t.Errorf("pickBannerStyle(%q) returned nil", style)
		}
		if tmpl.Name() != style {
			t.Errorf("pickBannerStyle(%q).Name() = %q", style, tmpl.Name())
		}
	}

	// Unknown style returns a valid template (random).
	tmpl := pickBannerStyle("nonexistent")
	if tmpl == nil {
		t.Error("pickBannerStyle(unknown) returned nil")
	}

	// Empty style returns a valid template.
	tmpl = pickBannerStyle("")
	if tmpl == nil {
		t.Error("pickBannerStyle('') returned nil")
	}
}

func TestBannerTemplateRender(t *testing.T) {
	data := bannerTemplateData{
		ThumbnailURL: "https://media.temptguide.com/thumb.jpg",
		Username:     "testuser",
		ClickURL:     "/b/42/click?src=test",
		HoverURL:     "/b/42/hover?src=test",
		Width:        300,
		Height:       250,
	}

	for _, style := range bannerStyles {
		t.Run(style, func(t *testing.T) {
			tmpl := pickBannerStyle(style)
			var buf bytes.Buffer
			err := tmpl.Execute(&buf, data)
			if err != nil {
				t.Fatalf("template %q render error: %v", style, err)
			}
			output := buf.String()

			// Check essential content is present.
			// Note: html/template escapes / as \/ in JS contexts,
			// so check for URL parts without leading slashes.
			checks := []string{
				data.ThumbnailURL,
				data.Username,
				"click?src=test",
				"hover?src=test",
				"300",
				"250",
			}
			for _, check := range checks {
				if !strings.Contains(output, check) {
					t.Errorf("template %q missing %q in output", style, check)
				}
			}
		})
	}
}
