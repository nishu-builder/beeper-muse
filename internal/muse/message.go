// Package muse defines the source-neutral contract shared by Muse adapters.
// It contains no browser selectors, Matrix IDs, credentials, or transport code.
package muse

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

type Role string

const (
	User      Role = "user"
	Assistant Role = "assistant"
)

type Image struct {
	URL string `json:"url"`
	Alt string `json:"alt,omitempty"`
	// Inline bytes are optional: browser CORS restrictions may allow only a link.
	Data string `json:"data,omitempty"`
	MIME string `json:"mime,omitempty"`
}
type Reaction struct {
	Actor Role   `json:"actor"`
	Key   string `json:"key"`
}
type Message struct {
	ID     string  `json:"id"`
	Role   Role    `json:"role"`
	Text   string  `json:"text"`
	HTML   string  `json:"html,omitempty"`
	Images []Image `json:"images,omitempty"`
	// TimestampMS is the source's original time, or zero when unavailable.
	TimestampMS  int64 `json:"timestampMs,omitempty"`
	ObservedAtMS int64 `json:"observedAtMs,omitempty"`
	Historical   bool  `json:"historical,omitempty"`
	// Read is an explicit source receipt, never inferred from an acknowledgment.
	Read bool `json:"read,omitempty"`
	// nil means unknown; an empty list means the source reports no reactions.
	Reactions *[]Reaction `json:"reactions,omitempty"`
}

func Hash(value string) string { h := sha256.Sum256([]byte(value)); return hex.EncodeToString(h[:]) }
func (m Message) ContentHash() string {
	images := make([]Image, len(m.Images))
	copy(images, m.Images)
	for i := range images {
		images[i].Data = ""
		images[i].MIME = ""
	}
	value, _ := json.Marshal(struct {
		Role       Role
		Text, HTML string
		Images     []Image
	}{m.Role, m.Text, m.HTML, images})
	return Hash(string(value))
}
func (m Message) RevisionHash() string {
	value, _ := json.Marshal(struct {
		Content   string
		Read      bool
		Reactions *[]Reaction
	}{m.ContentHash(), m.Read, m.Reactions})
	return Hash(string(value))
}
func SafeURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && len(raw) <= 8192
}
func (im Image) Bytes() ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(im.Data)
	if err != nil || len(b) == 0 || len(b) > 2*1024*1024 {
		return nil, errors.New("invalid image bytes")
	}
	mime := http.DetectContentType(b)
	if mime != im.MIME || (mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" && mime != "image/webp") {
		return nil, errors.New("unsupported image format")
	}
	return b, nil
}
func (m Message) Validate() error {
	if m.ID == "" || len(m.ID) > 256 || !utf8.ValidString(m.ID) || (m.Role != User && m.Role != Assistant) {
		return errors.New("invalid source identity")
	}
	if (!utf8.ValidString(m.Text)) || utf8.RuneCountInString(m.Text) > 23000 || len(m.HTML) > 128000 || !utf8.ValidString(m.HTML) || len(m.Images) > 4 || (strings.TrimSpace(m.Text) == "" && len(m.Images) == 0) {
		return errors.New("invalid source content")
	}
	limit := time.Now().Add(5 * time.Minute).UnixMilli()
	for _, ts := range []int64{m.TimestampMS, m.ObservedAtMS} {
		if ts != 0 && (ts < 946684800000 || ts > limit) {
			return errors.New("invalid source timestamp")
		}
	}
	if m.Reactions != nil {
		if len(*m.Reactions) > 16 {
			return errors.New("too many reactions")
		}
		seen := map[string]bool{}
		for _, r := range *m.Reactions {
			k := string(r.Actor) + ":" + r.Key
			if (r.Actor != User && r.Actor != Assistant) || strings.TrimSpace(r.Key) == "" || len(r.Key) > 64 || !utf8.ValidString(r.Key) || seen[k] {
				return errors.New("invalid reaction")
			}
			seen[k] = true
		}
	}
	total := 0
	for _, im := range m.Images {
		if !SafeURL(im.URL) || len(im.Alt) > 1000 {
			return errors.New("invalid image")
		}
		if im.Data != "" {
			b, err := im.Bytes()
			if err != nil {
				return err
			}
			total += len(b)
		}
	}
	if total > 4*1024*1024 {
		return errors.New("message images too large")
	}
	return nil
}
