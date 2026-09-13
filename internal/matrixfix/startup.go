// Package matrixfix contains narrowly scoped compatibility fixes for the pinned
// mautrix version. It does not change encryption algorithms or trust decisions.
package matrixfix

import (
	"context"
	"maunium.net/go/mautrix/bridgev2/matrix"
)

// RegisterBeforeDispatch installs the application-service crypto listeners
// before mautrix starts dispatching events. In mautrix v0.30.0, Crypto.Start is
// launched after EventProcessor.Start; pending key events can be dropped, or
// registration can race with a map read. Appservice-mode Start only registers
// listeners, so moving it into Init is safe. Long-polling mode is unchanged.
func RegisterBeforeDispatch(c *matrix.Connector) {
	if c.Crypto != nil && c.Config.Encryption.Appservice {
		c.Crypto = &appserviceCrypto{Crypto: c.Crypto}
	}
}

type appserviceCrypto struct{ matrix.Crypto }

func (c *appserviceCrypto) Init(ctx context.Context) error {
	if err := c.Crypto.Init(ctx); err != nil {
		return err
	}
	c.Crypto.Start()
	return nil
}
func (c *appserviceCrypto) Start() {}
