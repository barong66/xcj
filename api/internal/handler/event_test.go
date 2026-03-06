package handler

import "testing"

func TestExtractClickID(t *testing.T) {
	tests := []struct {
		name  string
		extra string
		want  string
	}{
		{"valid click_id", `{"click_id":"abc123","banner_id":42}`, "abc123"},
		{"no click_id", `{"banner_id":42}`, ""},
		{"empty string", "", ""},
		{"invalid json", "not json", ""},
		{"click_id is number", `{"click_id":123}`, ""},
		{"click_id is null", `{"click_id":null}`, ""},
		{"nested object", `{"click_id":"xyz","data":{"foo":"bar"}}`, "xyz"},
		{"empty click_id", `{"click_id":""}`, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractClickID(tt.extra)
			if got != tt.want {
				t.Errorf("extractClickID(%q) = %q, want %q", tt.extra, got, tt.want)
			}
		})
	}
}
