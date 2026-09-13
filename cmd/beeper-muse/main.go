package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/nishu-builder/beeper-muse/internal/connector"
	"github.com/nishu-builder/beeper-muse/internal/matrixfix"
	"github.com/nishu-builder/beeper-muse/internal/queue"
	"maunium.net/go/mautrix/bridgev2/matrix/mxmain"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "acknowledge" {
		if len(os.Args) != 3 {
			fmt.Fprintln(os.Stderr, "Usage: beeper-muse acknowledge <private data directory>")
			os.Exit(1)
		}
		q, err := queue.Open(os.Args[2])
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("Disconnect the extension and inspect both Muse and Beeper. This discards the interrupted job without retrying it.")
		fmt.Print("Type checked to continue: ")
		answer, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		if strings.TrimSpace(answer) != "checked" {
			_ = q.Close()
			fmt.Fprintln(os.Stderr, "Cancelled.")
			os.Exit(1)
		}
		err = q.Acknowledge()
		_ = q.Close()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("Acknowledged. Restart the bridge and reconnect the extension.")
		return
	}
	c := &connector.Connector{}
	bridge := mxmain.BridgeMain{Name: "beeper-muse", Description: "A direct Beeper-Muse browser bridge", URL: "https://github.com/nishu-builder/beeper-muse", Version: "0.3.0", Connector: c}
	bridge.PostInit = func() { matrixfix.RegisterBeforeDispatch(bridge.Matrix) }
	bridge.PostStart = func() {
		if _, err := c.EnsureChat(context.Background()); err != nil {
			bridge.Log.Error().Err(err).Msg("Could not prepare the Muse chat")
			bridge.TriggerStop(1)
		}
	}
	bridge.InitVersion("v0.3.0", "", "")
	bridge.PreInit()
	if err := c.Prepare(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	bridge.Init()
	bridge.Start()
	exitCode := bridge.WaitForInterrupt()
	bridge.Stop()
	os.Exit(exitCode)
}
