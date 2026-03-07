package s3

import (
	"testing"
)

func TestNewClient_StripsPrefixes(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
	}{
		{"https prefix", "https://fake.r2.dev"},
		{"http prefix", "http://fake.r2.dev"},
		{"no prefix", "fake.r2.dev"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := NewClient(tt.endpoint, "key", "secret", "auto", "bucket", "https://media.example.com")
			if err != nil {
				t.Fatalf("NewClient error: %v", err)
			}
			if c.bucket != "bucket" {
				t.Errorf("bucket = %q, want %q", c.bucket, "bucket")
			}
			if c.publicURL != "https://media.example.com" {
				t.Errorf("publicURL = %q, want %q", c.publicURL, "https://media.example.com")
			}
		})
	}
}

func TestNewClient_TrimsTrailingSlash(t *testing.T) {
	c, err := NewClient("https://fake.r2.dev", "key", "secret", "auto", "bucket", "https://media.example.com/")
	if err != nil {
		t.Fatalf("NewClient error: %v", err)
	}
	if c.publicURL != "https://media.example.com" {
		t.Errorf("publicURL = %q, want no trailing slash", c.publicURL)
	}
}
