package connector

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/nishu-builder/beeper-muse/internal/muse"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestNativeSenderAndSilentCatchupPolicy(t *testing.T) {
	owner := id.UserID("@owner:test")
	for _, tc := range []struct {
		m            muse.Message
		notify, read bool
	}{
		{muse.Message{Role: muse.Assistant}, true, false},
		{muse.Message{Role: muse.User}, false, false},
		{muse.Message{Role: muse.Assistant, Historical: true}, false, true},
		{muse.Message{Role: muse.Assistant, Read: true}, false, true},
	} {
		p := batchPolicy(tc.m, owner, true)
		if p.SendNotification != tc.notify || (p.MarkReadBy == owner) != tc.read || !p.Forward {
			t.Fatal("incorrect Beeper batch policy")
		}
	}
	if batchPolicy(muse.Message{Role: muse.Assistant}, owner, false).SendNotification {
		t.Fatal("edit triggers notification")
	}
	self := sourceSender(muse.User)
	if !self.IsFromMe || self.SenderLogin != loginID || self.Sender != selfID {
		t.Fatal("owner not mapped to native self")
	}
	if sourceSender(muse.Assistant).IsFromMe {
		t.Fatal("assistant mapped to owner")
	}
}
func TestSourceTimeDoesNotUseDeliveryClock(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC).UnixMilli()
	m := muse.Message{TimestampMS: ts, ObservedAtMS: ts + 60000}
	actual, kind := sourceTime(m)
	if actual.UnixMilli() != ts || kind != "source" {
		t.Fatal("source timestamp lost")
	}
	m.TimestampMS = 0
	actual, kind = sourceTime(m)
	if actual.UnixMilli() != ts+60000 || kind != "observed" {
		t.Fatal("unknown timestamp was invented")
	}
}

type uploadIntent struct {
	bridgev2.MatrixAPI
	called bool
}

func (i *uploadIntent) UploadMedia(_ context.Context, _ id.RoomID, data []byte, _ string, mime string) (id.ContentURIString, *event.EncryptedFileInfo, error) {
	i.called = true
	if len(data) == 0 || mime != "image/png" {
		panic("invalid upload")
	}
	return "", &event.EncryptedFileInfo{URL: "mxc://test/encrypted"}, nil
}
func TestRichContentUsesNativeHTMLAndEncryptedUploadResult(t *testing.T) {
	intent := &uploadIntent{}
	png := base64.StdEncoding.EncodeToString([]byte{'\x89', 'P', 'N', 'G', '\r', '\n', '\x1a', '\n', 0, 0, 0, 0})
	m := muse.Message{ID: "a", Role: muse.Assistant, Text: "An answer", HTML: `<b>An answer</b><script>bad()</script>`, Images: []muse.Image{{URL: "https://example.com/a.png", Data: png, MIME: "image/png", Alt: "Picture"}}}
	portal := &bridgev2.Portal{Portal: &database.Portal{MXID: "!test:test"}}
	parts, err := convertSource(context.Background(), portal, intent, m)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 2 || !intent.called || parts[0].Content.FormattedBody != "<b>An answer</b>" || parts[0].Content.Mentions == nil {
		t.Fatal("rich content was flattened or unsafe")
	}
	im := parts[1].Content
	if im.MsgType != event.MsgImage || im.File == nil || im.File.URL != "mxc://test/encrypted" || im.URL != "" {
		t.Fatal("encrypted upload was not preserved")
	}
}
