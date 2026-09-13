package matrixfix

import (
	"context"
	"errors"
	"maunium.net/go/mautrix/bridgev2/bridgeconfig"
	"maunium.net/go/mautrix/bridgev2/matrix"
	"reflect"
	"testing"
)

type fakeCrypto struct {
	matrix.Crypto
	calls []string
	err   error
}

func (f *fakeCrypto) Init(context.Context) error { f.calls = append(f.calls, "init"); return f.err }
func (f *fakeCrypto) Start()                     { f.calls = append(f.calls, "register") }

func TestRegistersCryptoHandlersBeforeDispatchAndOnlyOnce(t *testing.T) {
	original := &fakeCrypto{}
	c := &matrix.Connector{Crypto: original, Config: &bridgeconfig.Config{}}
	c.Config.Encryption.Appservice = true
	RegisterBeforeDispatch(c)
	if err := c.Crypto.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original.calls, []string{"init", "register"}) {
		t.Fatal("event dispatch could start without handlers", original.calls)
	}
	c.Crypto.Start()
	if len(original.calls) != 2 {
		t.Fatal("registered handlers twice")
	}
}
func TestFailedCryptoInitDoesNotRegisterAndSyncModeIsUnchanged(t *testing.T) {
	failure := errors.New("initialization failed")
	original := &fakeCrypto{err: failure}
	wrapped := &appserviceCrypto{Crypto: original}
	if !errors.Is(wrapped.Init(context.Background()), failure) {
		t.Fatal("init error lost")
	}
	if !reflect.DeepEqual(original.calls, []string{"init"}) {
		t.Fatal("registered after failure")
	}
	c := &matrix.Connector{Crypto: original, Config: &bridgeconfig.Config{}}
	RegisterBeforeDispatch(c)
	if c.Crypto != original {
		t.Fatal("changed long-polling startup")
	}
}
