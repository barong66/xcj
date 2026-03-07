package handler

import "testing"

func TestParseUA(t *testing.T) {
	tests := []struct {
		name       string
		ua         string
		wantBrw    string
		wantOS     string
		wantDevice string
	}{
		{
			name:       "Chrome on Windows",
			ua:         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			wantBrw:    "Chrome",
			wantOS:     "Windows 10",
			wantDevice: "desktop",
		},
		{
			name:       "Safari on iPhone",
			ua:         "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			wantBrw:    "Safari",
			wantOS:     "CPU iPhone OS 17_0 like Mac OS X",
			wantDevice: "mobile",
		},
		{
			name:       "Safari on iPad",
			ua:         "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			wantBrw:    "Safari",
			wantOS:     "CPU OS 17_0 like Mac OS X",
			wantDevice: "tablet",
		},
		{
			name:       "Googlebot",
			ua:         "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			wantBrw:    "Googlebot",
			wantOS:     "",
			wantDevice: "bot",
		},
		{
			name:       "empty UA",
			ua:         "",
			wantBrw:    "",
			wantOS:     "",
			wantDevice: "desktop",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := ParseUA(tt.ua)
			if info.Browser != tt.wantBrw {
				t.Errorf("Browser = %q, want %q", info.Browser, tt.wantBrw)
			}
			if info.OS != tt.wantOS {
				t.Errorf("OS = %q, want %q", info.OS, tt.wantOS)
			}
			if info.DeviceType != tt.wantDevice {
				t.Errorf("DeviceType = %q, want %q", info.DeviceType, tt.wantDevice)
			}
		})
	}
}
