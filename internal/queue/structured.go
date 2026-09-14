package queue

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/nishu-builder/beeper-muse/internal/muse"
	"strings"
	"time"
)

// Delivery keeps source identity separate from Matrix identity. The browser
// cannot set RemoteID or ReplyTo. Payloads are erased on completion.
type Delivery struct {
	Message  muse.Message `json:"message"`
	RemoteID string       `json:"remoteId"`
	ReplyTo  string       `json:"replyTo,omitempty"`
}

func validateMessages(messages []Incoming) error {
	if len(messages) == 0 || len(messages) > 20 {
		return errors.New("invalid import size")
	}
	total := 0
	for _, m := range messages {
		if err := m.Validate(); err != nil {
			return err
		}
		for _, im := range m.Images {
			total += len(im.Data)
		}
	}
	if total > 6*1024*1024 {
		return errors.New("import too large")
	}
	return nil
}
func (q *Queue) importTx(tx *sql.Tx, roomID string, messages []Incoming, replyTo string) (int, error) {
	var outstanding int
	if err := tx.QueryRow("SELECT COUNT(*) FROM jobs WHERE phase!='done'").Scan(&outstanding); err != nil {
		return 0, err
	}
	added := 0
	for _, m := range messages {
		hash := m.RevisionHash()
		var known int
		// Legacy receipts must not cause an upgrade to resend already imported text.
		if err := tx.QueryRow("SELECT COUNT(*) FROM muse_sources WHERE id=? AND hash = ?", m.ID, ID(string(m.Role)+"\n"+m.Text)).Scan(&known); err != nil {
			return 0, err
		}
		var role string
		var remoteID, lastHash string
		var revision int
		err := tx.QueryRow("SELECT role,remote_id,last_hash,revision FROM muse_links WHERE id=?", m.ID).Scan(&role, &remoteID, &lastHash, &revision)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}
		if m.Partial && role != "" {
			// Virtualized text lacks formatting, media, and reaction state. It
			// may fill missing history, but must never downgrade an existing ID.
			continue
		}
		if known > 0 && role == "" {
			continue
		}

		if lastHash == hash {
			continue
		}

		if role != "" && role != string(m.Role) {
			return 0, errors.New("source sender changed")
		}
		if remoteID == "" {
			remoteID = "muse-source:" + ID(m.ID)
			if _, err = tx.Exec("INSERT INTO muse_links(id,role,remote_id) VALUES(?,?,?)", m.ID, m.Role, remoteID); err != nil {
				return 0, err
			}
		}
		if outstanding+added >= 100 {
			return 0, errors.New("Muse delivery queue is full")
		}
		// First observation is persisted with the job, so queue delay/restarts do not
		// replace the timestamp with delivery time. Unknown source times stay explicit.
		if m.ObservedAtMS == 0 {
			m.ObservedAtMS = time.Now().UnixMilli()
		}
		payload, err := json.Marshal(Delivery{Message: m, RemoteID: remoteID, ReplyTo: replyTo})
		if err != nil {
			return 0, err
		}
		revision++
		eventID := "muse-source:" + ID(fmt.Sprintf("%s:%d:%s", m.ID, revision, hash))
		if _, err = tx.Exec("INSERT INTO jobs(id,event_id,room_id,prompt,result,phase,payload) VALUES(?,?,?,'',?,'ready',?)", ID(eventID), eventID, roomID, m.Text, string(payload)); err != nil {
			return 0, err
		}
		if _, err = tx.Exec("INSERT OR IGNORE INTO muse_sources(id,hash) VALUES(?,?)", m.ID, hash); err != nil {
			return 0, err
		}
		if _, err = tx.Exec("UPDATE muse_links SET last_hash=?,revision=? WHERE id=?", hash, revision, m.ID); err != nil {
			return 0, err
		}
		added++
	}
	return added, nil
}

// ResultMessages atomically binds the Muse echo to the existing Beeper message
// and queues each structured reply. No aggregate text reply is duplicated.
func (q *Queue) ResultMessages(jobID string, messages []Incoming) error {
	if err := validateMessages(messages); err != nil {
		return err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	tx, err := q.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var phase, room, prompt string
	if err = tx.QueryRow("SELECT phase,room_id,prompt FROM jobs WHERE id=?", jobID).Scan(&phase, &room, &prompt); err != nil {
		return ErrConflict
	}
	if phase == "done" {
		return nil
	}
	if phase != "claimed" {
		return ErrConflict
	}
	var echo *Incoming
	var replies []Incoming
	for _, m := range messages {
		if m.Role == muse.User {
			if echo != nil {
				return errors.New("ambiguous prompt echo")
			}
			v := m
			echo = &v
		} else {
			replies = append(replies, m)
		}
	}
	if echo == nil || strings.Join(strings.Fields(echo.Text), " ") != strings.Join(strings.Fields(prompt), " ") || len(replies) == 0 {
		return errors.New("missing prompt echo or answer")
	}
	remoteID := "user:" + jobID
	if _, err = tx.Exec("INSERT INTO muse_links(id,role,remote_id) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING", echo.ID, echo.Role, remoteID); err != nil {
		return err
	}
	var bound string
	if err = tx.QueryRow("SELECT remote_id FROM muse_links WHERE id=?", echo.ID).Scan(&bound); err != nil || bound != remoteID {
		return ErrConflict
	}
	if _, err = tx.Exec("INSERT OR IGNORE INTO muse_sources(id,hash) VALUES(?,?)", echo.ID, echo.RevisionHash()); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE muse_links SET last_hash=?,revision=1 WHERE id=?", echo.RevisionHash(), echo.ID); err != nil {
		return err
	}

	if _, err = tx.Exec("UPDATE jobs SET phase='done',prompt='',result='',payload='' WHERE id=?", jobID); err != nil {
		return err
	}
	if _, err = q.importTx(tx, room, replies, remoteID); err != nil {
		return err
	}
	return tx.Commit()
}
