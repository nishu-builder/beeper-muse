package connector

import (
	"context"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/bridgev2/networkid"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
	"strings"
	"testing"
)

func TestMemberValidationRejectsAdditionalRecipients(t *testing.T) {
	owner := id.UserID("@owner:test")
	bot := id.UserID("@bot:test")
	muse := id.UserID("@muse:test")
	members := map[id.UserID]*event.MemberEventContent{owner: {Membership: event.MembershipJoin}, muse: {Membership: event.MembershipJoin}, bot: {Membership: event.MembershipJoin}}
	if err := ValidateMembers(owner, bot, muse, members); err != nil {
		t.Fatal(err)
	}
	members["@other:test"] = &event.MemberEventContent{Membership: event.MembershipInvite}
	if err := ValidateMembers(owner, bot, muse, members); err == nil {
		t.Fatal("invited third party allowed")
	}
	delete(members, "@other:test")
	members[owner].Membership = event.MembershipLeave
	if err := ValidateMembers(owner, bot, muse, members); err == nil {
		t.Fatal("absent owner allowed")
	}
}
func TestDedicatedChatHasMuseIdentityAndRestrictedInvites(t *testing.T) {
	client := &Client{}
	portal := &bridgev2.Portal{Portal: &database.Portal{PortalKey: networkid.PortalKey{ID: portalID, Receiver: loginID}}}
	info, err := client.GetChatInfo(context.Background(), portal)
	if err != nil {
		t.Fatal(err)
	}
	if *info.Name != "Muse" || *info.Type != database.RoomTypeDM || info.Members.OtherUserID != museID {
		t.Fatal("not a dedicated Muse DM")
	}
	if info.Members.MemberMap[museID].IsFromMe {
		t.Fatal("Muse reply impersonates owner")
	}
	if *info.Members.PowerLevels.Invite != 100 {
		t.Fatal("invites unrestricted")
	}
	portal.ID = "other"
	if _, err = client.GetChatInfo(context.Background(), portal); err == nil {
		t.Fatal("unknown portal accepted")
	}
}
func TestConfigRequiresOneOwnerAndStrongPrivateToken(t *testing.T) {
	c := Config{Owner: "@owner:test", DataDir: t.TempDir(), RelayToken: strings.Repeat("a", 64)}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, owner := range []id.UserID{"*", "test", "@owner:test\n@other:test"} {
		bad := c
		bad.Owner = owner
		if bad.Validate() == nil {
			t.Fatal("invalid owner accepted")
		}
	}
	c.RelayToken = "short"
	if c.Validate() == nil {
		t.Fatal("weak token accepted")
	}
}

func TestPreparationLocksStateBeforeMatrixInitialization(t *testing.T) {
	config := Config{Owner: "@owner:test", DataDir: t.TempDir(), RelayToken: strings.Repeat("a", 64)}
	first := &Connector{Config: config}
	if err := first.Prepare(); err != nil {
		t.Fatal(err)
	}
	defer first.Stop()
	second := &Connector{Config: config}
	if err := second.Prepare(); err == nil {
		second.Stop()
		t.Fatal("second process could open private state")
	}
	if err := second.Start(context.Background()); err == nil {
		second.Stop()
		t.Fatal("unprepared connector started")
	}
}

func TestMessagesRejectWrongSenderPortalAndAttachmentsBeforeQueueing(t *testing.T) {
	client := &Client{connector: &Connector{Config: Config{Owner: "@owner:test"}}}
	msg := &bridgev2.MatrixMessage{MatrixEventBase: bridgev2.MatrixEventBase[*event.MessageEventContent]{
		Event:   &event.Event{Sender: "@other:test"},
		Portal:  &bridgev2.Portal{Portal: &database.Portal{PortalKey: networkid.PortalKey{ID: portalID, Receiver: loginID}}},
		Content: &event.MessageEventContent{MsgType: event.MsgText, Body: "Synthetic prompt"},
	}}
	if _, err := client.HandleMatrixMessage(context.Background(), msg); err == nil {
		t.Fatal("foreign sender accepted")
	}
	msg.Event.Sender = "@owner:test"
	msg.Portal.ID = "other"
	if _, err := client.HandleMatrixMessage(context.Background(), msg); err == nil {
		t.Fatal("foreign portal accepted")
	}
	msg.Portal.ID = portalID
	msg.Content.MsgType = event.MsgImage
	if _, err := client.HandleMatrixMessage(context.Background(), msg); err == nil {
		t.Fatal("attachment accepted")
	}
}
