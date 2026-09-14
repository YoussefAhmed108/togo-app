package handlers

import "testing"

func TestOwnKeyAndLocalKey(t *testing.T) {
	cases := []struct {
		key  string
		want bool
	}{
		{"memory/7/0f8c9a2e-1b3d-4c5e-9f70-123456789abc", true},
		{"memory/8/0f8c9a2e-1b3d-4c5e-9f70-123456789abc", false}, // another user's
		{"avatar/7/0f8c9a2e-1b3d-4c5e-9f70-123456789abc", false}, // wrong kind
		{"memory/7/../../etc/passwd", false},
		{"https://evil.example/x.png", false},
		{"memory/7/", false},
	}
	for _, c := range cases {
		if got := ownKey("memory", 7, c.key); got != c.want {
			t.Errorf("ownKey(%q) = %v, want %v", c.key, got, c.want)
		}
	}

	for _, bad := range []string{"../x", "memory/1/../../../tmp/x", "/etc/passwd", "memory/1/abc"} {
		if localKey.MatchString(bad) {
			t.Errorf("localKey accepted %q", bad)
		}
	}
	if !localKey.MatchString("avatar/1/0f8c9a2e-1b3d-4c5e-9f70-123456789abc") {
		t.Error("localKey rejected a presigned key")
	}
}
