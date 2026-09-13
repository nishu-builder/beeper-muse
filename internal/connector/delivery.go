package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"time"

	"github.com/nishu-builder/beeper-muse/internal/muse"
	"github.com/nishu-builder/beeper-muse/internal/queue"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/bridgev2/networkid"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

type messageMetadata struct {
	ContentHash string `json:"content_hash,omitempty"`
}

func sourceSender(role muse.Role) bridgev2.EventSender {
	if role == muse.User {
		return bridgev2.EventSender{IsFromMe: true, Sender: selfID, SenderLogin: loginID}
	}
	return bridgev2.EventSender{Sender: museID}
}
func sourceTime(m muse.Message) (time.Time, string) {
	if m.TimestampMS != 0 {
		return time.UnixMilli(m.TimestampMS), "source"
	}
	return time.UnixMilli(m.ObservedAtMS), "observed"
}
func (c *Connector) sourceIntent(ctx context.Context, portal *bridgev2.Portal, login *bridgev2.UserLogin, role muse.Role) (bridgev2.MatrixAPI, error) {
	// Require the real owner session. Never silently fall back to a second "You"
	// ghost or forward imported owner messages as new prompts.
	if role == muse.User && login.User.DoublePuppet(ctx) == nil {
		return nil, errors.New("Beeper self-sending session is unavailable")
	}
	intent, ok := portal.GetIntentFor(ctx, sourceSender(role), login, bridgev2.RemoteEventMessage)
	if !ok || intent == nil {
		return nil, errors.New("source sender unavailable")
	}
	if role == muse.User && intent.GetMXID() != c.Config.Owner {
		return nil, errors.New("incorrect self-sending identity")
	}
	return intent, nil
}
func convertSource(ctx context.Context, portal *bridgev2.Portal, intent bridgev2.MatrixAPI, m muse.Message) ([]*bridgev2.ConvertedMessagePart, error) {
	var parts []*bridgev2.ConvertedMessagePart
	if m.Text != "" {
		content := &event.MessageEventContent{MsgType: event.MsgText, Body: m.Text, Mentions: &event.Mentions{}}
		if formatted := muse.SafeHTML(m.HTML); formatted != "" {
			content.Format = event.FormatHTML
			content.FormattedBody = formatted
		}
		parts = append(parts, &bridgev2.ConvertedMessagePart{ID: "text", Type: event.EventMessage, Content: content})
	}
	for _, im := range m.Images {
		content := &event.MessageEventContent{Mentions: &event.Mentions{}}
		if im.Data == "" {
			content.MsgType = event.MsgText
			content.Body = im.URL
			content.Format = event.FormatHTML
			label := im.Alt
			if label == "" {
				label = "View image"
			}
			content.FormattedBody = `<a href="` + html.EscapeString(im.URL) + `">` + html.EscapeString(label) + `</a>`
		} else {
			data, err := im.Bytes()
			if err != nil {
				return nil, err
			}
			url, file, err := intent.UploadMedia(ctx, portal.MXID, data, "muse-image", im.MIME)
			if err != nil {
				return nil, err
			}
			content.MsgType = event.MsgImage
			content.Body = im.Alt
			if content.Body == "" {
				content.Body = "Muse image"
			}
			content.URL = url
			content.File = file
			content.Info = &event.FileInfo{MimeType: im.MIME, Size: len(data)}
		}
		parts = append(parts, &bridgev2.ConvertedMessagePart{ID: networkid.PartID(fmt.Sprintf("image-%s", muse.Hash(im.URL)[:20])), Type: event.EventMessage, Content: content})
	}
	return parts, nil
}
func batchPolicy(m muse.Message, owner id.UserID, hasNew bool) *mautrix.ReqBeeperBatchSend {
	req := &mautrix.ReqBeeperBatchSend{Forward: true, ForwardIfNoMessages: false, SendNotification: hasNew && !m.Historical && !m.Read && m.Role != muse.User}
	if m.Historical || m.Read {
		req.MarkReadBy = owner
	}
	return req
}

// deliverSource uses mautrix's encrypted BatchSend transport. Beeper's batch
// endpoint supports explicit notification suppression; ordinary live sends do
// not. Matrix IDs and delivery mappings stay entirely on the native side.
func (c *Connector) deliverSource(ctx context.Context, login *bridgev2.UserLogin, portal *bridgev2.Portal, job *queue.Job) error {
	var d queue.Delivery
	if err := json.Unmarshal([]byte(job.Payload), &d); err != nil {
		return err
	}
	m := d.Message
	if err := m.Validate(); err != nil {
		return err
	}
	if !c.bridge.Matrix.GetCapabilities().BatchSending {
		return errors.New("Beeper batch sending is required for source sync")
	}
	intent, err := c.sourceIntent(ctx, portal, login, m.Role)
	if err != nil {
		return err
	}
	remoteID := networkid.MessageID(d.RemoteID)
	existing, err := c.bridge.DB.Message.GetAllPartsByID(ctx, loginID, remoteID)
	if err != nil {
		return err
	}
	prior := map[networkid.PartID]*database.Message{}
	for _, part := range existing {
		prior[part.PartID] = part
	}
	contentHash := m.ContentHash()
	changed := len(existing) == 0
	for _, part := range existing {
		meta, ok := part.Metadata.(*messageMetadata)
		if !ok || meta.ContentHash != contentHash {
			changed = true
		}
	}
	ts, quality := sourceTime(m)
	if len(existing) > 0 {
		ts = existing[0].Timestamp
	} // Native edits preserve the original message timestamp.
	req := batchPolicy(m, c.Config.Owner, len(existing) == 0)
	var extras []*bridgev2.MatrixSendExtra
	var save []*database.Message
	if changed {
		parts, err := convertSource(ctx, portal, intent, m)
		if err != nil {
			return err
		}
		for i, part := range parts {
			old := prior[part.ID]
			eventID := c.bridge.Matrix.GenerateDeterministicEventID(portal.MXID, portal.PortalKey, remoteID, part.ID)
			dbm := old
			if old != nil {
				if old.SenderMXID != intent.GetMXID() {
					return errors.New("cannot change an existing message sender")
				}
				part.Content.SetEdit(old.MXID)
				eventID = c.bridge.Matrix.GenerateDeterministicEventID(portal.MXID, portal.PortalKey, networkid.MessageID(d.RemoteID+":edit:"+job.ID), part.ID)
			} else {
				dbm = &database.Message{ID: remoteID, PartID: part.ID, MXID: eventID, Room: portal.PortalKey, SenderID: sourceSender(m.Role).Sender, SenderMXID: intent.GetMXID(), Timestamp: ts, IsDoublePuppeted: intent.IsDoublePuppet()}
				if d.ReplyTo != "" {
					reply, err := c.bridge.DB.Message.GetFirstPartByID(ctx, loginID, networkid.MessageID(d.ReplyTo))
					if err != nil {
						return err
					}
					if reply != nil {
						part.Content.RelatesTo = &event.RelatesTo{InReplyTo: &event.InReplyTo{EventID: reply.MXID}}
						dbm.ReplyTo = networkid.MessageOptionalPartID{MessageID: reply.ID}
					}
				}
			}
			dbm.Metadata = &messageMetadata{ContentHash: contentHash}
			eventTime := ts
			if old != nil {
				eventTime = time.UnixMilli(m.ObservedAtMS)
			}
			req.Events = append(req.Events, &event.Event{ID: eventID, RoomID: portal.MXID, Sender: intent.GetMXID(), Type: part.Type, Timestamp: eventTime.UnixMilli(), Content: event.Content{Parsed: part.Content, Raw: map[string]any{"com.beeper.muse.timestamp_source": quality}}})
			extras = append(extras, &bridgev2.MatrixSendExtra{MessageMeta: dbm, PartIndex: i})
			save = append(save, dbm)
			delete(prior, part.ID)
		}
		if len(req.Events) > 0 {
			if _, err = c.bridge.Matrix.BatchSend(ctx, portal.MXID, req, extras); err != nil {
				return err
			}
		}
		for _, dbm := range save {
			if dbm.RowID == 0 {
				err = c.bridge.DB.Message.Insert(ctx, dbm)
			} else {
				err = c.bridge.DB.Message.Update(ctx, dbm)
			}
			if err != nil {
				return err
			}
		}
		// Removed parts are native redactions, not additional explanatory messages.
		for _, old := range prior {
			if _, err = intent.SendMessage(ctx, portal.MXID, event.EventRedaction, &event.Content{Parsed: &event.RedactionEventContent{Redacts: old.MXID, DontRenderPlaceholder: true}}, &bridgev2.MatrixSendExtra{Timestamp: time.UnixMilli(m.ObservedAtMS), MessageMeta: old}); err != nil {
				return err
			}
			if err = c.bridge.DB.Message.Delete(ctx, old.RowID); err != nil {
				return err
			}
		}
	}
	target, err := c.bridge.DB.Message.GetFirstPartByID(ctx, loginID, remoteID)
	if err != nil || target == nil {
		return errors.New("source message mapping was not saved")
	}
	if err = c.syncSourceReactions(ctx, login, portal, target, m, job.ID); err != nil {
		return err
	}
	if m.Read && !m.Historical {
		dp := login.User.DoublePuppet(ctx)
		if dp == nil {
			return errors.New("read receipt session unavailable")
		}
		if err = dp.MarkRead(ctx, portal.MXID, target.MXID, time.UnixMilli(m.ObservedAtMS)); err != nil {
			return err
		}
	}
	return c.queue.Complete(job.ID)
}
func (c *Connector) syncSourceReactions(ctx context.Context, login *bridgev2.UserLogin, portal *bridgev2.Portal, target *database.Message, m muse.Message, revision string) error {
	if m.Reactions == nil {
		return nil
	}
	existing, err := c.bridge.DB.Reaction.GetAllToMessage(ctx, loginID, target.ID)
	if err != nil {
		return err
	}
	old := map[string]*database.Reaction{}
	for _, r := range existing {
		old[string(r.SenderID)+":"+r.Emoji] = r
	}
	for _, r := range *m.Reactions {
		sender := sourceSender(r.Actor)
		key := string(sender.Sender) + ":" + r.Key
		if old[key] != nil {
			delete(old, key)
			continue
		}
		intent, err := c.sourceIntent(ctx, portal, login, r.Actor)
		if err != nil {
			return err
		}
		reaction := &database.Reaction{Room: portal.PortalKey, MessageID: target.ID, MessagePartID: target.PartID, SenderID: sender.Sender, SenderMXID: intent.GetMXID(), EmojiID: networkid.EmojiID(r.Key), Emoji: r.Key, Timestamp: time.UnixMilli(m.ObservedAtMS)}
		// Include revision so remove -> re-add is a new event, but uncertain retries are stable.
		reaction.MXID = c.bridge.Matrix.GenerateDeterministicEventID(portal.MXID, portal.PortalKey, networkid.MessageID(string(target.ID)+":reaction:"+revision), networkid.PartID(key))
		req := &mautrix.ReqBeeperBatchSend{Forward: true, SendNotification: false, Events: []*event.Event{{ID: reaction.MXID, RoomID: portal.MXID, Sender: intent.GetMXID(), Type: event.EventReaction, Timestamp: reaction.Timestamp.UnixMilli(), Content: event.Content{Parsed: &event.ReactionEventContent{RelatesTo: event.RelatesTo{Type: event.RelAnnotation, EventID: target.MXID, Key: r.Key}}}}}}
		if _, err = c.bridge.Matrix.BatchSend(ctx, portal.MXID, req, []*bridgev2.MatrixSendExtra{{ReactionMeta: reaction}}); err != nil {
			return err
		}
		if err = c.bridge.DB.Reaction.Upsert(ctx, reaction); err != nil {
			return err
		}
	}
	for _, r := range old {
		role := muse.Assistant
		if r.SenderID == selfID {
			role = muse.User
		} else if r.SenderID != museID {
			continue
		}
		intent, err := c.sourceIntent(ctx, portal, login, role)
		if err != nil {
			return err
		}
		if _, err = intent.SendMessage(ctx, portal.MXID, event.EventRedaction, &event.Content{Parsed: &event.RedactionEventContent{Redacts: r.MXID}}, &bridgev2.MatrixSendExtra{Timestamp: time.UnixMilli(m.ObservedAtMS), ReactionMeta: r}); err != nil {
			return err
		}
		if err = c.bridge.DB.Reaction.Delete(ctx, r); err != nil {
			return err
		}
	}
	return nil
}
