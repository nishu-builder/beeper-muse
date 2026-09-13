package queue

import (
	"database/sql"
	"errors"
	"github.com/nishu-builder/beeper-muse/internal/muse"
	"regexp"
	"unicode/utf8"
)

type Source struct {
	ID   string `json:"id"`
	Hash string `json:"hash"`
}

type Incoming = muse.Message

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
	if roomID == "" {
		return 0, errors.New("invalid destination")
	}
	if err := validateMessages(messages); err != nil {
		return 0, err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	tx, err := q.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	n, err := q.importTx(tx, roomID, messages, "")
	if err != nil {
		return 0, err
	}
	return n, tx.Commit()
}
