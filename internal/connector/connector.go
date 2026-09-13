// Package connector presents one existing Muse browser conversation as a Beeper DM.
package connector

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/nishu-builder/beeper-muse/internal/queue"
	"go.mau.fi/util/configupgrade"
	"go.mau.fi/util/ptr"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/bridgev2/networkid"
	"maunium.net/go/mautrix/bridgev2/simplevent"
	"maunium.net/go/mautrix/bridgev2/status"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const loginID networkid.UserLoginID = "browser"
const museID networkid.UserID = "muse"
const selfID networkid.UserID = "owner"
const portalID networkid.PortalID = "muse"
const browserAddress = "127.0.0.1:24819"

type Config struct {
	Owner      id.UserID `yaml:"owner"`
	DataDir    string    `yaml:"data_dir"`
	RelayToken string    `yaml:"relay_token"`
}

func (c Config) Validate() error {
	if !regexp.MustCompile(`^@[^:[:space:]]+:[^[:space:]]+$`).MatchString(string(c.Owner)) {
		return errors.New("network.owner must identify the one Beeper user allowed to use Muse")
	}
	if c.DataDir == "" {
		return errors.New("network.data_dir is required")
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(c.RelayToken) {
		return errors.New("network.relay_token must be a random 32-byte hex token; run setup")
	}
	return nil
}

type Connector struct {
	Config  Config
	bridge  *bridgev2.Bridge
	queue   *queue.Queue
	server  *http.Server
	cancel  context.CancelFunc
	workers sync.WaitGroup
}

var _ bridgev2.NetworkConnector = (*Connector)(nil)
var _ bridgev2.StoppableNetwork = (*Connector)(nil)

func (c *Connector) Init(br *bridgev2.Bridge) { c.bridge = br }
func (c *Connector) GetName() bridgev2.BridgeName {
	return bridgev2.BridgeName{DisplayName: "Muse", NetworkURL: "https://muse.ai", NetworkID: "muse", BeeperBridgeType: "github.com/nishu-builder/beeper-muse", DefaultPort: 24820, DefaultCommandPrefix: "!muse-bridge"}
}
func (c *Connector) GetBridgeInfoVersion() (int, int) { return 1, 1 }
func (c *Connector) GetCapabilities() *bridgev2.NetworkGeneralCapabilities {
	return &bridgev2.NetworkGeneralCapabilities{}
}
func (c *Connector) GetDBMetaTypes() database.MetaTypes { return database.MetaTypes{} }
func (c *Connector) GetConfig() (string, any, configupgrade.Upgrader) {
	return "owner: '@you:beeper.com'\ndata_dir: .local\nrelay_token: ''\n", &c.Config, configupgrade.SimpleUpgrader(func(helper configupgrade.Helper) {
		helper.Copy(configupgrade.Str, "owner")
		helper.Copy(configupgrade.Str, "data_dir")
		helper.Copy(configupgrade.Str, "relay_token")
	})
}

// Prepare reserves the private state before the framework opens its crypto DB.
func (c *Connector) Prepare() error {
	if err := c.Config.Validate(); err != nil {
		return err
	}
	var err error
	c.queue, err = queue.Open(c.Config.DataDir)
	return err
}

func (c *Connector) Start(ctx context.Context) error {
	if c.queue == nil {
		return errors.New("connector must be prepared before Matrix startup")
	}
	listener, err := net.Listen("tcp", browserAddress)
	if err != nil {
		_ = c.queue.Close()
		return errors.New("browser relay port 24819 is unavailable; stop the old connector first")
	}
	c.server = &http.Server{Handler: queue.Handler(c.queue, c.Config.RelayToken, browserAddress, c.importMessages), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	ctx, c.cancel = context.WithCancel(ctx)
	c.workers.Add(2)
	go func() {
		defer c.workers.Done()
		if err := c.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			c.bridge.Log.Error().Msg("Browser relay stopped unexpectedly")
		}
	}()
	go func() {
		defer c.workers.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.tick(ctx)
			}
		}
	}()
	return nil
}
func (c *Connector) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	if c.server != nil {
		_ = c.server.Close()
	}
	c.workers.Wait()
	if c.queue != nil {
		_ = c.queue.Close()
	}
}
func (c *Connector) LoadUserLogin(_ context.Context, login *bridgev2.UserLogin) error {
	if login.UserMXID != c.Config.Owner || login.ID != loginID {
		return errors.New("login does not belong to the configured owner")
	}
	login.Client = &Client{connector: c, login: login}
	return nil
}

// EnsureChat runs after Matrix startup. Registration grants access to just the
// configured owner; no Muse password or session token is stored by the bridge.
func (c *Connector) EnsureChat(ctx context.Context) (*bridgev2.UserLogin, error) {
	user, err := c.bridge.GetUserByMXID(ctx, c.Config.Owner)
	if err != nil {
		return nil, err
	}
	login, err := user.NewLogin(ctx, &database.UserLogin{ID: loginID, RemoteName: "Muse browser"}, nil)
	if err != nil {
		return nil, err
	}
	login.Client.Connect(ctx)
	portal, err := c.bridge.GetPortalByKey(ctx, networkid.PortalKey{ID: portalID, Receiver: loginID})
	if err != nil {
		return nil, err
	}
	info, err := login.Client.GetChatInfo(ctx, portal)
	if err != nil {
		return nil, err
	}
	if err = portal.CreateMatrixRoom(ctx, login, info); err != nil {
		return nil, err
	}
	data, _ := json.Marshal(map[string]string{"roomID": string(portal.MXID), "name": "Muse"})
	if err = os.WriteFile(filepath.Join(c.Config.DataDir, "chat.json"), data, 0600); err != nil {
		return nil, err
	}
	c.bridge.Log.Info().Msg("Muse chat is ready. Connect your signed-in Muse tab with the browser extension.")
	return login, nil
}

func (c *Connector) membersSafe(ctx context.Context, roomID id.RoomID) error {
	ghost, err := c.bridge.GetGhostByID(ctx, museID)
	if err != nil {
		return err
	}
	members, err := c.bridge.Matrix.GetMembers(ctx, roomID)
	if err != nil {
		return err
	}
	return ValidateMembers(c.Config.Owner, c.bridge.Bot.GetMXID(), ghost.Intent.GetMXID(), members)
}

func ValidateMembers(owner, bot, muse id.UserID, members map[id.UserID]*event.MemberEventContent) error {
	ownerJoined := false
	museJoined := false
	for user, member := range members {
		if member.Membership != event.MembershipJoin && member.Membership != event.MembershipInvite {
			continue
		}
		if user != owner && user != bot && user != muse {
			return errors.New("Muse only supports a private conversation with the configured owner")
		}
		if user == owner && member.Membership == event.MembershipJoin {
			ownerJoined = true
		}
		if user == muse && member.Membership == event.MembershipJoin {
			museJoined = true
		}
	}
	if !ownerJoined || !museJoined {
		return errors.New("the owner and Muse must both be in the conversation")
	}
	return nil
}

func (c *Connector) importMessages(ctx context.Context, messages []queue.Incoming) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	portal, err := c.bridge.GetPortalByKey(ctx, networkid.PortalKey{ID: portalID, Receiver: loginID})
	if err != nil || portal == nil || portal.MXID == "" {
		return 0, errors.New("Muse chat is not ready")
	}
	if err = c.membersSafe(ctx, portal.MXID); err != nil {
		return 0, err
	}
	return c.queue.Import(string(portal.MXID), messages)
}

func (c *Connector) tick(ctx context.Context) {
	login := c.bridge.GetCachedUserLoginByID(loginID)
	if login == nil {
		return
	}
	job, err := c.queue.BeginDelivery()
	if err != nil {
		c.bridge.Log.Error().Msg("Cannot read the Muse queue")
		return
	}
	if job == nil {
		return
	}
	portal, err := c.bridge.GetPortalByKey(ctx, networkid.PortalKey{ID: portalID, Receiver: loginID})
	if err != nil || portal == nil || string(portal.MXID) != job.RoomID || c.membersSafe(ctx, portal.MXID) != nil {
		_ = c.queue.Block(job.ID)
		c.bridge.Log.Error().Msg("Muse reply blocked: the destination could not be validated")
		return
	}
	replyID := networkid.MessageID("muse:" + job.ID)
	var replyTo *networkid.MessageOptionalPartID
	if !strings.HasPrefix(job.EventID, "muse-dom:") {
		replyTo = &networkid.MessageOptionalPartID{MessageID: networkid.MessageID("user:" + job.ID)}
	}
	result := login.QueueRemoteEvent(&simplevent.PreConvertedMessage{
		EventMeta: simplevent.EventMeta{
			Type: bridgev2.RemoteEventMessage, PortalKey: portal.PortalKey, Sender: bridgev2.EventSender{Sender: museID}, Timestamp: time.Now(),
			PostHandleFunc: func(ctx context.Context, portal *bridgev2.Portal) {
				saved, err := c.bridge.DB.Message.GetFirstPartByID(ctx, loginID, replyID)
				if err == nil && saved != nil && saved.MXID != "" {
					err = c.queue.Complete(job.ID)
				} else {
					err = c.queue.Block(job.ID)
				}
				if err != nil {
					c.bridge.Log.Error().Msg("Could not persist Muse delivery status; inspect the queue before restarting")
				}
			},
		},
		ID: replyID, Data: &bridgev2.ConvertedMessage{
			ReplyTo: replyTo,
			Parts:   []*bridgev2.ConvertedMessagePart{{Type: event.EventMessage, Content: &event.MessageEventContent{MsgType: event.MsgText, Body: job.Result}}},
		},
	})
	if !result.Success || result.Ignored {
		_ = c.queue.Block(job.ID)
	}
}

type Client struct {
	connector *Connector
	login     *bridgev2.UserLogin
}

var _ bridgev2.NetworkAPI = (*Client)(nil)
var _ bridgev2.IdentifierResolvingNetworkAPI = (*Client)(nil)
var _ bridgev2.ContactListingNetworkAPI = (*Client)(nil)

func (c *Client) Connect(context.Context) {
	c.login.BridgeState.Send(status.BridgeState{StateEvent: status.StateConnected})
}
func (c *Client) Disconnect()                                              {}
func (c *Client) LogoutRemote(context.Context)                             {}
func (c *Client) IsLoggedIn() bool                                         { return true }
func (c *Client) IsThisUser(_ context.Context, user networkid.UserID) bool { return user == selfID }
func (c *Client) GetCapabilities(context.Context, *bridgev2.Portal) *event.RoomFeatures {
	return &event.RoomFeatures{ID: "muse-v1", MaxTextLength: queue.MaxPrompt}
}
func (c *Client) GetUserInfo(_ context.Context, ghost *bridgev2.Ghost) (*bridgev2.UserInfo, error) {
	if ghost.ID == selfID {
		return &bridgev2.UserInfo{Name: ptr.Ptr("You")}, nil
	}
	if ghost.ID != museID {
		return nil, errors.New("unknown Muse contact")
	}
	return &bridgev2.UserInfo{Name: ptr.Ptr("Muse")}, nil
}
func (c *Client) GetChatInfo(_ context.Context, portal *bridgev2.Portal) (*bridgev2.ChatInfo, error) {
	if portal.ID != portalID || portal.Receiver != loginID {
		return nil, errors.New("unknown Muse conversation")
	}
	return &bridgev2.ChatInfo{Name: ptr.Ptr("Muse"), Topic: ptr.Ptr("Your existing Muse conversation, connected through your browser."), Type: ptr.Ptr(database.RoomTypeDM), Members: &bridgev2.ChatMemberList{
		IsFull: true, OtherUserID: museID, MemberMap: bridgev2.ChatMemberMap{
			selfID: {EventSender: bridgev2.EventSender{IsFromMe: true, Sender: selfID, SenderLogin: loginID}, Membership: event.MembershipJoin, PowerLevel: ptr.Ptr(50)},
			museID: {EventSender: bridgev2.EventSender{Sender: museID}, Membership: event.MembershipJoin, PowerLevel: ptr.Ptr(50)},
		}, PowerLevels: &bridgev2.PowerLevelOverrides{Invite: ptr.Ptr(100), StateDefault: ptr.Ptr(100)},
	}}, nil
}
func (c *Client) HandleMatrixMessage(ctx context.Context, msg *bridgev2.MatrixMessage) (*bridgev2.MatrixMessageResponse, error) {
	if msg.Event.Sender != c.connector.Config.Owner || msg.OrigSender != nil || msg.Portal.ID != portalID || msg.Portal.Receiver != loginID {
		return nil, errors.New("message is outside the configured Muse conversation")
	}
	if msg.Content.MsgType != event.MsgText {
		return nil, errors.New("Muse currently supports text messages only")
	}
	if err := c.connector.membersSafe(ctx, msg.Portal.MXID); err != nil {
		return nil, err
	}
	prompt := *msg.Content
	prompt.RemoveReplyFallback()
	jobID, err := c.connector.queue.Enqueue(string(msg.Event.ID), string(msg.Portal.MXID), prompt.Body)
	if err != nil {
		return nil, err
	}
	return &bridgev2.MatrixMessageResponse{DB: &database.Message{ID: networkid.MessageID("user:" + jobID), SenderID: selfID}}, nil
}
func (c *Client) ResolveIdentifier(ctx context.Context, identifier string, _ bool) (*bridgev2.ResolveIdentifierResponse, error) {
	if !strings.EqualFold(strings.TrimSpace(identifier), "muse") {
		return nil, errors.New("the only available contact is Muse")
	}
	ghost, err := c.connector.bridge.GetGhostByID(ctx, museID)
	if err != nil {
		return nil, err
	}
	portal, err := c.connector.bridge.GetPortalByKey(ctx, networkid.PortalKey{ID: portalID, Receiver: loginID})
	if err != nil {
		return nil, err
	}
	userInfo, _ := c.GetUserInfo(ctx, ghost)
	chatInfo, _ := c.GetChatInfo(ctx, portal)
	return &bridgev2.ResolveIdentifierResponse{Ghost: ghost, UserID: museID, UserInfo: userInfo, Chat: &bridgev2.CreateChatResponse{Portal: portal, PortalKey: portal.PortalKey, PortalInfo: chatInfo}}, nil
}
func (c *Client) GetContactList(ctx context.Context) ([]*bridgev2.ResolveIdentifierResponse, error) {
	contact, err := c.ResolveIdentifier(ctx, "muse", false)
	if err != nil {
		return nil, err
	}
	return []*bridgev2.ResolveIdentifierResponse{contact}, nil
}

func (c *Connector) GetLoginFlows() []bridgev2.LoginFlow {
	return []bridgev2.LoginFlow{{ID: "browser", Name: "Muse browser", Description: "Connect your existing Muse browser session"}}
}
func (c *Connector) CreateLogin(_ context.Context, user *bridgev2.User, flow string) (bridgev2.LoginProcess, error) {
	if user.MXID != c.Config.Owner || flow != "browser" {
		return nil, errors.New("only the configured owner can connect Muse")
	}
	return &loginProcess{connector: c}, nil
}

type loginProcess struct{ connector *Connector }

func (p *loginProcess) Cancel() {}
func (p *loginProcess) Start(ctx context.Context) (*bridgev2.LoginStep, error) {
	login, err := p.connector.EnsureChat(ctx)
	if err != nil {
		return nil, err
	}
	return &bridgev2.LoginStep{Type: bridgev2.LoginStepTypeComplete, StepID: "muse.complete", Instructions: "Connect your signed-in Muse tab with the browser extension.", CompleteParams: &bridgev2.LoginCompleteParams{UserLoginID: login.ID, UserLogin: login}}, nil
}
