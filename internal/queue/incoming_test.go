package queue

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestImportPersistsReceiptsAndRevisions(t *testing.T) {
	dir := t.TempDir()
	q, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	messages := []Incoming{{ID: "u", Role: "user", Text: "Synthetic question"}, {ID: "a", Role: "assistant", Text: "Synthetic answer"}}
	if n, err := q.Import("!private:test", messages); err != nil || n != 2 {
		t.Fatalf("import: %d %v", n, err)
	}
	first, _ := q.BeginDelivery()
	if first == nil || first.Result != "Synthetic question" || first.Payload == "" {
		t.Fatal("missing structured user message")
	}
	if err := q.Complete(first.ID); err != nil {
		t.Fatal(err)
	}
	second, _ := q.BeginDelivery()
	if second == nil || second.Result != "Synthetic answer" {
		t.Fatal("missing answer")
	}
	if err := q.Complete(second.ID); err != nil {
		t.Fatal(err)
	}
	if err := q.Close(); err != nil {
		t.Fatal(err)
	}
	q, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	if n, err := q.Import("!private:test", messages); err != nil || n != 0 {
		t.Fatalf("duplicate after restart: %d %v", n, err)
	}
	messages[1].Text = "A later update"
	if n, err := q.Import("!private:test", messages); err != nil || n != 1 {
		t.Fatalf("revision: %d %v", n, err)
	}
	changed, _ := q.BeginDelivery()
	if changed == nil || changed.Result != "A later update" || changed.Payload == "" {
		t.Fatal("missing structured update")
	}
}
func TestConcurrentImportsDeduplicate(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	var added atomic.Int64
	var workers sync.WaitGroup
	for i := 0; i < 10; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			n, err := q.Import("!private:test", []Incoming{{ID: "same", Role: "assistant", Text: "Synthetic"}})
			if err != nil {
				t.Error(err)
			}
			added.Add(int64(n))
		}()
	}
	workers.Wait()
	if added.Load() != 1 {
		t.Fatal("concurrent snapshots duplicated a message")
	}
}
func TestImportCapacityFailureRollsBackJobsAndReceipts(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	for i := 0; i < 99; i++ {
		if _, err := q.Import("!private:test", []Incoming{{ID: fmt.Sprint(i), Role: "assistant", Text: "Synthetic"}}); err != nil {
			t.Fatal(err)
		}
	}
	batch := []Incoming{{ID: "next-a", Role: "assistant", Text: "Synthetic"}, {ID: "next-b", Role: "assistant", Text: "Synthetic"}}
	if _, err := q.Import("!private:test", batch); err == nil {
		t.Fatal("queue capacity not enforced")
	}
	status, _ := q.Status()
	if status.Queued != 99 {
		t.Fatal("failed batch partially queued")
	}
	job, _ := q.BeginDelivery()
	if err := q.Complete(job.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := q.Import("!private:test", batch); err != nil || n != 2 {
		t.Fatalf("failed batch retained receipts: %d %v", n, err)
	}
}
func TestResultSourcesPreventObserverDuplicates(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	job, _ := q.Enqueue("$outbound", "!private:test", "Synthetic question")
	_, _ = q.Claim()
	source := Source{ID: "muse-answer", Hash: ID("assistant\nSynthetic answer")}
	if err := q.Result(job, "Synthetic answer", source); err != nil {
		t.Fatal(err)
	}
	if n, err := q.Import("!private:test", []Incoming{{ID: source.ID, Role: "assistant", Text: "Synthetic answer"}}); err != nil || n != 0 {
		t.Fatalf("echo duplicated: %d %v", n, err)
	}
	if err := q.Result(job, "Synthetic answer", source); err != nil {
		t.Fatal(err)
	}
	status, _ := q.Status()
	if status.Queued != 1 {
		t.Fatal("result retry changed queue")
	}
}
func TestInvalidImportDoesNotPartiallyQueueOrRememberMessages(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	valid := Incoming{ID: "ok", Role: "assistant", Text: "Synthetic"}
	if _, err := q.Import("!private:test", []Incoming{valid, {ID: "bad", Role: "system", Text: "Rejected"}}); err == nil {
		t.Fatal("accepted invalid role")
	}
	if n, err := q.Import("!private:test", []Incoming{valid}); err != nil || n != 1 {
		t.Fatal("failed batch was partially remembered")
	}
	if _, err := q.Import("", []Incoming{valid}); err == nil {
		t.Fatal("missing destination accepted")
	}
}
func TestImportRouteRequiresAuthenticationAndCannotSelectDestination(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	token := strings.Repeat("a", 64)
	calls := 0
	handler := Handler(q, token, "127.0.0.1:24819", Callbacks{Import: func(_ context.Context, messages []Incoming) (int, error) {
		calls++
		return q.Import("!configured:test", messages)
	}})
	for _, tc := range []struct {
		body, auth string
		status     int
	}{
		{`{"messages":[{"id":"a","role":"assistant","text":"Synthetic"}]}`, "", 403},
		{`{"messages":[{"id":"a","role":"assistant","text":"Synthetic"}],"roomID":"!other:test"}`, "Bearer " + token, 400},
		{`{"messages":[{"id":"a","role":"assistant","text":"Synthetic"}]}`, "Bearer " + token, 200},
	} {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24819/v1/import", strings.NewReader(tc.body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", tc.auth)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != tc.status {
			t.Fatalf("status %d, wanted %d", recorder.Code, tc.status)
		}
	}
	if calls != 1 {
		t.Fatal("unauthorized importer call")
	}
	job, _ := q.BeginDelivery()
	if job == nil || job.RoomID != "!configured:test" {
		t.Fatal("incorrect destination")
	}
}

func TestStructuredReversionIsAnEditNotLostAsAnOldDuplicate(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	for _, text := range []string{"Original", "Edited", "Original"} {
		if n, err := q.Import("!test:test", []Incoming{{ID: "same", Role: "assistant", Text: text}}); err != nil || n != 1 {
			t.Fatalf("revision lost: %d %v", n, err)
		}
		job, _ := q.BeginDelivery()
		if job == nil {
			t.Fatal("missing job")
		}
		if err = q.Complete(job.ID); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := q.Import("!test:test", []Incoming{{ID: "same", Role: "assistant", Text: "Original"}}); err != nil || n != 0 {
		t.Fatal("unchanged revision duplicated")
	}
}
func TestStructuredResultBindsEchoAndKeepsIndividualAnswers(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	job, _ := q.Enqueue("$prompt", "!test:test", "Question")
	_, _ = q.Claim()
	messages := []Incoming{{ID: "u", Role: "user", Text: "Question"}, {ID: "a", Role: "assistant", Text: "Answer", HTML: "<b>Answer</b>"}, {ID: "b", Role: "assistant", Text: "Followup"}}
	if err = q.ResultMessages(job, messages); err != nil {
		t.Fatal(err)
	}
	if err = q.ResultMessages(job, messages); err != nil {
		t.Fatal(err)
	}
	if n, err := q.Import("!test:test", messages); err != nil || n != 0 {
		t.Fatalf("result echoed %d %v", n, err)
	}
	status, _ := q.Status()
	if status.Queued != 2 {
		t.Fatal("answers not kept separately")
	}
	first, _ := q.BeginDelivery()
	if first == nil || !strings.Contains(first.Payload, "user:"+job) || !strings.Contains(first.Payload, "html") {
		t.Fatal("native reply mapping or formatting lost")
	}
	if err = q.Complete(first.ID); err != nil {
		t.Fatal(err)
	}
	var payload string
	if err = q.db.QueryRow("SELECT payload FROM jobs WHERE id=?", first.ID).Scan(&payload); err != nil || payload != "" {
		t.Fatal("completed structured content retained")
	}
}

func TestLegacyReceiptSuppressesUpgradeReplayButNotFutureReversions(t *testing.T) {
	q, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	_, err = q.db.Exec("INSERT INTO muse_sources(id,hash) VALUES(?,?)", "legacy", ID("assistant\nOriginal"))
	if err != nil {
		t.Fatal(err)
	}
	m := Incoming{ID: "legacy", Role: "assistant", Text: "Original"}
	if n, err := q.Import("!test:test", []Incoming{m}); err != nil || n != 0 {
		t.Fatal("legacy history replayed")
	}
	m.Text = "Revised"
	if n, err := q.Import("!test:test", []Incoming{m}); err != nil || n != 1 {
		t.Fatal("new revision lost")
	}
	j, _ := q.BeginDelivery()
	if err = q.Complete(j.ID); err != nil {
		t.Fatal(err)
	}
	m.Text = "Original"
	if n, err := q.Import("!test:test", []Incoming{m}); err != nil || n != 1 {
		t.Fatal("legacy hash suppressed real reversion")
	}
}
