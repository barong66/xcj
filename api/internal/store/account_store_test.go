package store

import (
	"context"
	"testing"
)

// TestGetTopCategoriesByViews_ZeroLimit verifies the guard that prevents
// DB queries when limit <= 0. The pool is nil intentionally — the guard
// must return before any pool call, so no panic occurs.
func TestGetTopCategoriesByViews_ZeroLimit(t *testing.T) {
	s := &AccountStore{pool: nil}

	for _, limit := range []int{0, -1, -100} {
		cats, err := s.GetTopCategoriesByViews(context.Background(), 1, 1, limit)
		if err != nil {
			t.Errorf("limit=%d: unexpected error: %v", limit, err)
		}
		if cats != nil {
			t.Errorf("limit=%d: expected nil, got %v", limit, cats)
		}
	}
}
