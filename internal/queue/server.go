package queue

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"github.com/nishu-builder/beeper-muse/internal/muse"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var extensionOrigin = regexp.MustCompile(`^chrome-extension://[a-p]{32}$`)

type Callbacks struct {
	Import   func(context.Context, []Incoming) (int, error)
	Activity func(context.Context, muse.Activity) error
}

func Handler(q *Queue, token, host string, callbacks ...Callbacks) http.Handler {
	var handlers Callbacks
	if len(callbacks) > 0 {
		handlers = callbacks[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if r.Host != host || (origin != "" && !extensionOrigin.MatchString(origin)) || token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, `{"error":"forbidden"}`, 403)
			return
		}
		reply := func(value any) { _ = json.NewEncoder(w).Encode(value) }
		if r.Method == http.MethodGet && r.URL.Path == "/v1/status" {
			s, err := q.Status()
			if err != nil {
				http.Error(w, `{"error":"unavailable"}`, 503)
				return
			}
			reply(map[string]any{"phase": s.Phase, "queued": s.Queued, "museSync": handlers.Import != nil, "sourceProtocol": 2, "activitySync": handlers.Activity != nil})
			return
		}
		if r.Method != http.MethodPost || !strings.EqualFold(r.Header.Get("Content-Type"), "application/json") {
			http.NotFound(w, r)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024*1024)
		var input *struct {
			ID       string         `json:"id"`
			Text     string         `json:"text"`
			Sources  []Source       `json:"sources"`
			Messages []Incoming     `json:"messages"`
			Activity *muse.Activity `json:"activity"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || input == nil {
			http.Error(w, `{"error":"invalid request"}`, 400)
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			http.Error(w, `{"error":"invalid request"}`, 400)
			return
		}
		var err error
		switch r.URL.Path {
		case "/v1/claim":
			var job *Job
			job, err = q.Claim()
			if err == nil {
				reply(map[string]any{"job": job})
				return
			}
		case "/v2/result":
			err = q.ResultMessages(input.ID, input.Messages)
		case "/v1/result":
			err = q.Result(input.ID, input.Text, input.Sources...)
		case "/v1/import":
			if handlers.Import == nil {
				http.NotFound(w, r)
				return
			}
			var added int
			added, err = handlers.Import(r.Context(), input.Messages)
			if err == nil {
				reply(map[string]any{"ok": true, "added": added})
				return
			}
		case "/v1/activity":
			if handlers.Activity == nil {
				http.NotFound(w, r)
				return
			}
			if input.Activity == nil || (*input.Activity != muse.Idle && *input.Activity != muse.Working) {
				http.Error(w, `{"error":"invalid activity"}`, 400)
				return
			}
			err = handlers.Activity(r.Context(), *input.Activity)
		case "/v1/block":
			err = q.Block(input.ID)
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, `{"error":"request could not be completed"}`, 409)
			return
		}
		reply(map[string]bool{"ok": true})
	})
}
