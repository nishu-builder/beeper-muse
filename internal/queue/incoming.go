package queue

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

type Source struct {
	ID   string `json:"id"`
	Hash string `json:"hash"`
}

type Incoming struct {
	ID   string `json:"id"`
	Role string `json:"role"`
	Text string `json:"text"`
}

var sourceHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

func validSourceID(id string) bool { return id != "" && len(id) <= 256 && utf8.ValidString(id) }
func validateSources(sources []Source) error {
	if len(sources) > 64 {
		return errors.New("too many source messages")
	}
	for _, source := range sources {
		if !validSourceID(source.ID) || !sourceHash.MatchString(source.Hash) {
			return errors.New("invalid source message")
		}
	}
	return nil
}
func recordSources(tx *sql.Tx, sources []Source) error {
	for _, source := range sources {
		if _, err := tx.Exec("INSERT OR IGNORE INTO muse_sources(id,hash) VALUES(?,?)", source.ID, source.Hash); err != nil {
			return err
		}
	}
	return nil
}

// Import records each source revision and its durable delivery in one transaction.
// Source hashes contain no message bodies and survive Chrome restarts.
func (q *Queue) Import(roomID string, messages []Incoming) (int, error) {
	if roomID == "" || len(messages) == 0 || len(messages) > 20 {
		return 0, errors.New("invalid import")
	}
	for _, message := range messages {
		if !validSourceID(message.ID) || (message.Role != "user" && message.Role != "assistant") ||
			strings.TrimSpace(message.Text) == "" || !utf8.ValidString(message.Text) || utf8.RuneCountInString(message.Text) > 23000 {
			return 0, errors.New("invalid Muse message")
		}
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	tx, err := q.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var outstanding int
	if err = tx.QueryRow("SELECT COUNT(*) FROM jobs WHERE phase!='done'").Scan(&outstanding); err != nil {
		return 0, err
	}
	added := 0
	for _, message := range messages {
		hash := ID(message.Role + "\n" + message.Text)
		result, err := tx.Exec("INSERT OR IGNORE INTO muse_sources(id,hash) VALUES(?,?)", message.ID, hash)
		if err != nil {
			return 0, err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return 0, err
		}
		if n == 0 {
			continue
		}
		if outstanding+added >= 100 {
			return 0, errors.New("Muse delivery queue is full")
		}
		eventID := "muse-dom:" + ID(message.ID+":"+hash)
		body := message.Text
		if message.Role == "user" {
			body = "You in Muse:\n" + body
		}
		var revisions int
		if err = tx.QueryRow("SELECT COUNT(*) FROM muse_sources WHERE id=?", message.ID).Scan(&revisions); err != nil {
			return 0, err
		}
		if revisions > 1 && message.Role == "assistant" {
			body = "Updated Muse reply:\n" + body
		}
		if _, err = tx.Exec("INSERT INTO jobs(id,event_id,room_id,prompt,result,phase) VALUES(?,?,?,'',?,'ready')", ID(eventID), eventID, roomID, body); err != nil {
			return 0, err
		}
		added++
	}
	return added, tx.Commit()
}
