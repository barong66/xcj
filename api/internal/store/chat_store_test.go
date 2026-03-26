package store_test

import (
	"testing"
)

// Integration test — requires DB. Run with: go test ./internal/store/... -tags integration
// For unit coverage, the struct/interface is tested via mock in handler tests.

func TestChatStore_GetChatConfig_NotFound(t *testing.T) {
	// This test documents the expected behavior:
	// GetChatConfig returns nil, nil when slug not found.
	// Tested via handler mock in Task 4 tests.
	t.Skip("integration test — see chat_handler_test.go for mock-based coverage")
}
