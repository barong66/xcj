package config

import (
	"os"
	"testing"
)

func TestConfig_XAIAPIKey(t *testing.T) {
	os.Setenv("XAI_API_KEY", "test-key-123")
	defer os.Unsetenv("XAI_API_KEY")

	cfg := Load()
	if cfg.XAIAPIKey != "test-key-123" {
		t.Errorf("expected XAIAPIKey=test-key-123, got %q", cfg.XAIAPIKey)
	}
}

func TestConfig_XAIAPIKey_Default(t *testing.T) {
	os.Unsetenv("XAI_API_KEY")
	cfg := Load()
	if cfg.XAIAPIKey != "" {
		t.Errorf("expected empty XAIAPIKey by default, got %q", cfg.XAIAPIKey)
	}
}
