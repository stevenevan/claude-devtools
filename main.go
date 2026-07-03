package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/analyticsservice"
	"claude-devtools/internal/cache"
	"claude-devtools/internal/configservice"
	"claude-devtools/internal/filesservice"
	"claude-devtools/internal/maintenanceservice"
	"claude-devtools/internal/notifyservice"
	"claude-devtools/internal/searchservice"
	"claude-devtools/internal/sessionservice"
	"claude-devtools/internal/snapshotservice"
	"claude-devtools/internal/sshservice"
	"claude-devtools/internal/systemservice"
	"claude-devtools/internal/timingservice"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// One shared session cache for the whole app (arch C1): the same pointer is
	// injected into every cache-consuming service so they share state — never one
	// cache per service.
	sessionCache := cache.Default()

	app := application.New(application.Options{
		Name:        "claude-devtools",
		Description: "Visualizes Claude Code session execution",
		Services: []application.Service{
			application.NewService(sessionservice.New(sessionCache)),
			application.NewService(searchservice.New(sessionCache)),
			application.NewService(analyticsservice.New()),
			application.NewService(&configservice.ConfigService{}),
			application.NewService(&notifyservice.NotificationService{}),
			application.NewService(&sshservice.SshService{}),
			application.NewService(&filesservice.FilesService{}),
			application.NewService(snapshotservice.New()),
			application.NewService(timingservice.New(sessionCache)),
			application.NewService(&systemservice.SystemService{}),
			application.NewService(&maintenanceservice.MaintenanceService{}),
			// watcher service registered here in W3
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Transparent title bar: traffic lights visible, content under the bar
	// (reproduces Tauri's titleBarStyle:"Overlay" + hiddenTitle:true).
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "claude-devtools",
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		URL:       "/",
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBar{AppearsTransparent: true},
			InvisibleTitleBarHeight: 40,
		},
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
