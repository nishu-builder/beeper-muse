package queue

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nishu-builder/beeper-muse/internal/muse"
)

func TestActivityIsAuthenticatedValidatedAndEphemeral(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	token := strings.Repeat("a", 64)
	var states []muse.Activity
	h := Handler(q, token, "127.0.0.1:24819", Callbacks{Activity: func(_ context.Context, state muse.Activity) error {
		states = append(states, state)
		return nil
	}})
	for _, tc := range []struct {
		body, auth string
		status     int
	}{
		{`{"activity":"working"}`, "", 403},
		{`{"activity":"working","roomID":"!other:test"}`, "Bearer " + token, 400},
		{`{}`, "Bearer " + token, 400},
		{`{"activity":"typing"}`, "Bearer " + token, 400},
		{`{"activity":"working"}`, "Bearer " + token, 200},
		{`{"activity":"idle"}`, "Bearer " + token, 200},
	} {
		r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24819/v1/activity", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", tc.auth)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("status %d, wanted %d", w.Code, tc.status)
		}
	}
	if len(states) != 2 || states[0] != muse.Working || states[1] != muse.Idle {
		t.Fatal("wrong source activity")
	}
	var count int
	if err = q.db.QueryRow("SELECT COUNT(*) FROM jobs").Scan(&count); err != nil || count != 0 {
		t.Fatal("activity was persisted as a message")
	}
}
