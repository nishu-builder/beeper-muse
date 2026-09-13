package muse

import (
	"strings"
	"testing"
)

func TestHTMLCannotCarryActiveContentOrMentions(t *testing.T) {
	input := `<p onclick="steal()">Hello <strong>world</strong><a href="https://example.com/a?x=1&amp;y=2">link</a><a href="javascript:alert(1)">bad</a><a href="https://matrix.to/#/@owner:test">mention</a><img src="https://track.test"><script>secret()</script><iframe>hidden</iframe><button>Approve</button></p><table><tr><td>Cell</td></tr></table>`
	result := SafeHTML(input)
	for _, bad := range []string{"onclick", "javascript", "matrix.to", "<img", "secret", "hidden", "Approve"} {
		if strings.Contains(result, bad) {
			t.Fatalf("unsafe HTML contains %q", bad)
		}
	}
	for _, want := range []string{"<strong>world</strong>", "<table>", "https://example.com/a?x=1&amp;y=2"} {
		if !strings.Contains(result, want) {
			t.Fatalf("formatting lost: %q", want)
		}
	}
}
func TestValidationRejectsMalformedAndOverlargeMedia(t *testing.T) {
	base := Message{ID: "a", Role: Assistant, Text: "Test"}
	for _, bad := range []Image{{URL: "file:///private"}, {URL: "https://user:password@example.com/a"}, {URL: "https://example.com/a", Data: "not-base64", MIME: "image/png"}, {URL: "https://example.com/a", Data: "PHN2Zz48L3N2Zz4=", MIME: "image/svg+xml"}} {
		m := base
		m.Images = []Image{bad}
		if m.Validate() == nil {
			t.Fatal("invalid media accepted")
		}
	}
	m := base
	m.TimestampMS = 1234567890
	if m.Validate() == nil {
		t.Fatal("seconds accepted as milliseconds")
	}
}
func TestContentRevisionsExcludeCaptureTimeAndImageTransport(t *testing.T) {
	a := Message{ID: "a", Role: Assistant, Text: "Answer", Images: []Image{{URL: "https://example.com/a.png"}}}
	b := a
	b.Images = append([]Image(nil), a.Images...)
	b.Images[0].Data = "bytes"
	b.Images[0].MIME = "image/png"
	b.ObservedAtMS = 1800000000000
	b.Historical = true
	if a.ContentHash() != b.ContentHash() || a.RevisionHash() != b.RevisionHash() {
		t.Fatal("observation metadata changes content identity")
	}
	b.Read = true
	if a.ContentHash() != b.ContentHash() || a.RevisionHash() == b.RevisionHash() {
		t.Fatal("receipt must be independent of content")
	}
}
