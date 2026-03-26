package store

import "encoding/json"

// unmarshalJSON is a generic helper for deserializing JSONB columns.
// Defined here to avoid redeclaration conflicts across store files.
func unmarshalJSON[T any](data []byte, v *T) error {
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}
