import AppKit

// Headless one-shot modes useful for checking the data layer without a window:
//   AgentHUD --dump              one board snapshot as JSON (local + remote)
//   AgentHUD --dump --no-remote  local agents only
if CommandLine.arguments.contains("--dump") {
    HUDConfig.writeExampleIfMissing()
    let config = HUDConfig.load()
    let includeRemote = !CommandLine.arguments.contains("--no-remote")
    print(DumpMode.run(config: config, includeRemote: includeRemote))
    exit(0)
}

if CommandLine.arguments.contains("--cmux-workspace") {
    print(CmuxJumper.herdrTUIWorkspaceID() ?? "not-found")
    exit(0)
}

if CommandLine.arguments.contains("--cmux-focus") {
    CmuxJumper.focusHerdrWorkspace()
    print("focused")
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
