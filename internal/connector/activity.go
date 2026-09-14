package connector

import (
	"context"
	"errors"
	"time"

	"github.com/nishu-builder/beeper-muse/internal/muse"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/networkid"
)

// setActivity sends a native, expiring typing event as Muse. It cannot create a
// message, advance a read marker, change the destination, or survive a restart.
func (c *Connector) setActivity(ctx context.Context, state muse.Activity) error {
	if state != muse.Idle && state != muse.Working {
		return errors.New("invalid activity")
	}
	c.activityMu.Lock()
	defer c.activityMu.Unlock()
	if state == c.activityState && (state == muse.Idle || time.Since(c.activityAt) < 5*time.Second) {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	portal, err := c.bridge.GetPortalByKey(ctx, networkid.PortalKey{ID: portalID, Receiver: loginID})
	if err != nil || portal == nil || portal.MXID == "" {
		return errors.New("Muse chat is not ready")
	}
	// Clearing activity is harmless if membership changed, but publishing new
	// activity still requires the same private-room checks as message delivery.
	if state == muse.Working {
		if err = c.membersSafe(ctx, portal.MXID); err != nil {
			return err
		}
	}
	ghost, err := c.bridge.GetGhostByID(ctx, museID)
	if err != nil {
		return err
	}
	var timeout time.Duration
	if state == muse.Working {
		timeout = 12 * time.Second
	}
	if err = ghost.Intent.MarkTyping(ctx, portal.MXID, bridgev2.TypingTypeText, timeout); err != nil {
		return err
	}
	c.activityState, c.activityAt = state, time.Now()
	return nil
}
