// Package queue durably separates Matrix delivery from browser interaction.
package queue

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "github.com/mattn/go-sqlite3"
)

const MaxPrompt = 8000
const MaxResult = 24000

var ErrConflict = errors.New("job is not in the required state")

type Job struct {
	ID        string `json:"id"`
	Prompt    string `json:"prompt"`
	EventID   string `json:"-"`
	RoomID    string `json:"-"`
	Phase     string `json:"-"`
	Result    string `json:"-"`
	ClaimedAt int64  `json:"-"`
}

type Status struct {
	Phase  string `json:"phase"`
	Queued int    `json:"queued"`
}

type Queue struct {
	mu     sync.Mutex
	db     *sql.DB
	lock   string
	closed bool
}

func Open(dir string) (*Queue, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	lock := filepath.Join(dir, "connector.lock")
	f, err := os.OpenFile(lock, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, errors.New("connector.lock exists or cannot be created; stop the other instance and see docs/operations.md")
	}
	_, err = fmt.Fprintf(f, "{\"pid\":%d}\n", os.Getpid())
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		_ = os.Remove(lock)
		return nil, errors.New("cannot persist process lock")
	}
	q := &Queue{lock: lock}
	ok := false
	defer func() {
		if !ok {
			_ = q.Close()
		}
	}()
	path := filepath.Join(dir, "queue.db")
	f, err = os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	_ = f.Close()
	q.db, err = sql.Open("sqlite3", path+"?_journal_mode=WAL&_synchronous=FULL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	q.db.SetMaxOpenConns(1)
	_, err = q.db.Exec(`CREATE TABLE IF NOT EXISTS jobs (
 seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL UNIQUE,
 room_id TEXT NOT NULL, prompt TEXT NOT NULL, result TEXT NOT NULL DEFAULT '',
 phase TEXT NOT NULL CHECK(phase IN ('queued','claimed','ready','delivering','blocked','done')),
 claimed_at INTEGER NOT NULL DEFAULT 0
 ); UPDATE jobs SET phase='blocked' WHERE phase IN ('claimed','delivering');`)
	if err != nil {
		return nil, err
	}
	ok = true
	return q, nil
}

func (q *Queue) Close() error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return nil
	}
	q.closed = true
	var err error
	if q.db != nil {
		err = q.db.Close()
	}
	if removeErr := os.Remove(q.lock); err == nil {
		err = removeErr
	}
	return err
}

func ID(eventID string) string {
	hash := sha256.Sum256([]byte(eventID))
	return hex.EncodeToString(hash[:])
}

func (q *Queue) Enqueue(eventID, roomID, prompt string) (string, error) {
	if eventID == "" || roomID == "" || strings.TrimSpace(prompt) == "" || !utf8.ValidString(prompt) || utf8.RuneCountInString(prompt) > MaxPrompt {
		return "", errors.New("only nonempty text messages of at most 8000 characters are supported")
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	id := ID(eventID)
	var exists int
	if err := q.db.QueryRow("SELECT COUNT(*) FROM jobs WHERE id=?", id).Scan(&exists); err != nil {
		return "", err
	}
	if exists > 0 {
		return id, nil
	}
	var count int
	if err := q.db.QueryRow("SELECT COUNT(*) FROM jobs WHERE phase!='done'").Scan(&count); err != nil {
		return "", err
	}
	if count >= 20 {
		return "", errors.New("Muse queue is full; allow existing prompts to finish")
	}
	_, err := q.db.Exec("INSERT INTO jobs(id,event_id,room_id,prompt,phase) VALUES(?,?,?,?,'queued')", id, eventID, roomID, prompt)
	return id, err
}

func (q *Queue) head() (*Job, error) {
	var j Job
	err := q.db.QueryRow("SELECT id,event_id,room_id,prompt,result,phase,claimed_at FROM jobs WHERE phase!='done' ORDER BY seq LIMIT 1").Scan(&j.ID, &j.EventID, &j.RoomID, &j.Prompt, &j.Result, &j.Phase, &j.ClaimedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &j, err
}

func (q *Queue) Status() (Status, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	s := Status{Phase: "idle"}
	j, err := q.head()
	if err != nil {
		return s, err
	}
	if j != nil {
		s.Phase = j.Phase
	}
	err = q.db.QueryRow("SELECT COUNT(*) FROM jobs WHERE phase!='done'").Scan(&s.Queued)
	return s, err
}

func (q *Queue) Claim() (*Job, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, err := q.head()
	if err != nil || j == nil {
		return nil, err
	}
	if j.Phase != "queued" {
		return nil, nil
	}
	_, err = q.db.Exec("UPDATE jobs SET phase='claimed',claimed_at=? WHERE id=?", time.Now().Unix(), j.ID)
	if err != nil {
		return nil, err
	}
	return j, nil
}

func (q *Queue) Result(id, text string) error {
	if strings.TrimSpace(text) == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > MaxResult {
		return errors.New("invalid result")
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	var phase, old string
	if err := q.db.QueryRow("SELECT phase,result FROM jobs WHERE id=?", id).Scan(&phase, &old); err != nil {
		return ErrConflict
	}
	if phase == "done" || ((phase == "ready" || phase == "delivering") && old == text) {
		return nil
	}
	if phase != "claimed" {
		return ErrConflict
	}
	_, err := q.db.Exec("UPDATE jobs SET result=?,phase='ready' WHERE id=?", text, id)
	return err
}

// BeginDelivery persists the uncertain state before handing a reply to Matrix.
func (q *Queue) BeginDelivery() (*Job, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if _, err := q.db.Exec("UPDATE jobs SET phase='blocked' WHERE phase='claimed' AND claimed_at<?", time.Now().Add(-30*time.Minute).Unix()); err != nil {
		return nil, err
	}
	j, err := q.head()
	if err != nil || j == nil {
		return nil, err
	}
	if j.Phase != "ready" {
		return nil, nil
	}
	_, err = q.db.Exec("UPDATE jobs SET phase='delivering' WHERE id=?", j.ID)
	if err != nil {
		return nil, err
	}
	return j, nil
}

func (q *Queue) Complete(id string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	result, err := q.db.Exec("UPDATE jobs SET phase='done',prompt='',result='' WHERE id=? AND phase='delivering'", id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return ErrConflict
	}
	return err
}

func (q *Queue) Block(id string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, err := q.db.Exec("UPDATE jobs SET phase='blocked' WHERE id=? AND phase IN ('claimed','delivering')", id)
	return err
}

// Acknowledge is called only by the stopped-bridge recovery command.
func (q *Queue) Acknowledge() error {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, err := q.head()
	if err != nil {
		return err
	}
	if j == nil || j.Phase != "blocked" {
		return ErrConflict
	}
	_, err = q.db.Exec("UPDATE jobs SET phase='done',prompt='',result='' WHERE id=?", j.ID)
	return err
}
