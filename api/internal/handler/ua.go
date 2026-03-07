package handler

import (
	"strings"

	"github.com/mssola/useragent"
)

// UAInfo holds parsed user-agent data.
type UAInfo struct {
	Browser    string
	OS         string
	DeviceType string
}

// ParseUA extracts browser, OS, and device type from a raw user-agent string.
func ParseUA(raw string) UAInfo {
	ua := useragent.New(raw)
	name, _ := ua.Browser()
	os := ua.OS()

	lower := strings.ToLower(raw)
	var dt string
	switch {
	case ua.Bot():
		dt = "bot"
	case strings.Contains(lower, "ipad") || strings.Contains(lower, "tablet"):
		dt = "tablet"
	case ua.Mobile():
		dt = "mobile"
	default:
		dt = "desktop"
	}

	return UAInfo{Browser: name, OS: os, DeviceType: dt}
}
