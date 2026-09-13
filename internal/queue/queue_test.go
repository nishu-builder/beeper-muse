package queue

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func openTest(t *testing.T) *Queue {
	t.Helper()
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = q.Close() })
	return q
}
func mustEnqueue(t *testing.T, q *Queue, event string) string {
	t.Helper()
	id, err := q.Enqueue(event, "!muse:test", "Synthetic prompt")
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func TestClaimsAreDurableAndSerialized(t *testing.T) {
	q := openTest(t)
	id := mustEnqueue(t, q, "$one")
	var wg sync.WaitGroup
	claims := make(chan *Job, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			j, err := q.Claim()
			if err != nil {
				t.Error(err)
			}
			claims <- j
		}()
	}
	wg.Wait()
	close(claims)
	count := 0
	for j := range claims {
		if j != nil {
			count++
			if j.ID != id {
				t.Fatal("wrong job")
			}
		}
	}
	if count != 1 {
		t.Fatalf("claims=%d", count)
	}
}
func TestDuplicateEventsAndResultsDeliverOnlyOnce(t *testing.T) {
	q := openTest(t)
	id := mustEnqueue(t, q, "$one")
	if got := mustEnqueue(t, q, "$one"); got != id {
		t.Fatal("unstable ID")
	}
	if _, err := q.Claim(); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := q.Result(id, "Synthetic reply"); err != nil {
			t.Fatal(err)
		}
	}
	job, err := q.BeginDelivery()
	if err != nil || job == nil {
		t.Fatal("missing delivery", err)
	}
	if err = q.Result(id, "Synthetic reply"); err != nil {
		t.Fatal(err)
	}
	if err = q.Complete(id); err != nil {
		t.Fatal(err)
	}
	if err = q.Result(id, "Synthetic reply"); err != nil {
		t.Fatal(err)
	}
	if job, err = q.BeginDelivery(); err != nil || job != nil {
		t.Fatal("duplicate delivery")
	}
	mustEnqueue(t, q, "$one")
	s, _ := q.Status()
	if s.Queued != 0 {
		t.Fatal("replayed event")
	}
	var prompt, result string
	if err = q.db.QueryRow("SELECT prompt,result FROM jobs WHERE id=?", id).Scan(&prompt, &result); err != nil || prompt != "" || result != "" {
		t.Fatal("completed content retained")
	}
}
func TestRestartBlocksUncertainWork(t *testing.T) {
	for _, phase := range []string{"claimed", "delivering"} {
		t.Run(phase, func(t *testing.T) {
			dir := t.TempDir()
			q, err := Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			id := mustEnqueue(t, q, "$one")
			_, _ = q.Claim()
			if phase == "delivering" {
				_ = q.Result(id, "reply")
				_, _ = q.BeginDelivery()
			}
			if err = q.Close(); err != nil {
				t.Fatal(err)
			}
			resumed, err := Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer resumed.Close()
			s, _ := resumed.Status()
			if s.Phase != "blocked" {
				t.Fatalf("phase=%s", s.Phase)
			}
			if j, _ := resumed.Claim(); j != nil {
				t.Fatal("uncertain prompt replayed")
			}
			if err = resumed.Acknowledge(); err != nil {
				t.Fatal(err)
			}
			s, _ = resumed.Status()
			if s.Phase != "idle" {
				t.Fatal(s)
			}
		})
	}
}
func TestQueueBoundariesAndResultAttribution(t *testing.T) {
	q := openTest(t)
	for _, prompt := range []string{"", " ", strings.Repeat("x", MaxPrompt+1)} {
		if _, err := q.Enqueue("bad", "room", prompt); err == nil {
			t.Fatal("invalid prompt accepted")
		}
	}
	id := mustEnqueue(t, q, "$one")
	if err := q.Result(id, "premature"); err == nil {
		t.Fatal("unclaimed result accepted")
	}
	_, _ = q.Claim()
	if err := q.Result("wrong", "reply"); err == nil {
		t.Fatal("wrong job accepted")
	}
	if err := q.Result(id, strings.Repeat("x", MaxResult+1)); err == nil {
		t.Fatal("oversized result")
	}
	for i := 1; i < 20; i++ {
		mustEnqueue(t, q, fmt.Sprint(i))
	}
	if _, err := q.Enqueue("overflow", "room", "hi"); err == nil {
		t.Fatal("queue overflow")
	}
	if err := q.Block(id); err != nil {
		t.Fatal(err)
	}
	if j, _ := q.Claim(); j != nil {
		t.Fatal("blocked head was skipped")
	}
}
func TestLockPermissionsAndRepeatedClose(t *testing.T) {
	dir := t.TempDir()
	q, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Open(dir); err == nil {
		t.Fatal("second writer allowed")
	}
	info, err := os.Stat(filepath.Join(dir, "queue.db"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("database permissions")
	}
	_ = q.Close()
	next, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	_ = q.Close()
	if _, err = Open(dir); err == nil {
		t.Fatal("old close removed new lock")
	}
}
func TestExpiredBrowserClaimBlocks(t *testing.T) {
	q := openTest(t)
	mustEnqueue(t, q, "$one")
	_, _ = q.Claim()
	_, _ = q.db.Exec("UPDATE jobs SET claimed_at=1")
	j, err := q.BeginDelivery()
	if err != nil || j != nil {
		t.Fatal("expired claim delivered")
	}
	s, _ := q.Status()
	if s.Phase != "blocked" {
		t.Fatal(s)
	}
}
func TestHTTPRequiresTokenLocalHostAndExtensionOrigin(t *testing.T) {
	q := openTest(t)
	mustEnqueue(t, q, "$one")
	token := strings.Repeat("a", 64)
	handler := Handler(q, token, "127.0.0.1:24819")
	call := func(host, origin, auth, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24819/v1/claim", strings.NewReader(body))
		r.Host = host
		r.Header.Set("Origin", origin)
		r.Header.Set("Authorization", auth)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, args := range [][3]string{{"evil.test", "", "Bearer " + token}, {"127.0.0.1:24819", "https://muse.ai", "Bearer " + token}, {"127.0.0.1:24819", "", "Bearer wrong"}} {
		if w := call(args[0], args[1], args[2], "{}"); w.Code != 403 {
			t.Fatal(w.Code)
		}
	}
	for _, body := range []string{"null", "{} {}", `{"unknown":true}`, strings.Repeat("x", 262145)} {
		if w := call("127.0.0.1:24819", "", "Bearer "+token, body); w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	w := call("127.0.0.1:24819", "chrome-extension://"+strings.Repeat("a", 32), "Bearer "+token, "{}")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(w.Body.String(), token) || strings.Contains(w.Body.String(), "!muse:test") {
		t.Fatal("private routing data leaked")
	}
	var job map[string]any
	_ = json.Unmarshal(response["job"], &job)
	if len(job) != 2 || job["prompt"] != "Synthetic prompt" {
		t.Fatal("unexpected job payload")
	}
}
