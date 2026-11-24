import AppKit
import Foundation

/// Brings the cmux window/tab that hosts the Herdr TUI to the front, then lets
/// Herdr's own focus switch the active pane.
///
/// The Herdr TUI is a process launched inside cmux. Its environment carries the
/// uuid of the cmux workspace (= tab) it lives in, and cmux exposes a small
/// AppleScript dictionary with `select tab` / `activate window`. That is the
/// clean, permission-scoped way to jump there; nothing here writes to cmux.
enum CmuxJumper {
    /// Focus the cmux workspace that hosts Herdr (activating the app as a fallback).
    static func focusHerdrWorkspace() {
        let started = Date()
        guard let workspace = herdrTUIWorkspaceID() else {
            HUDLog.write("cmux: herdr TUI workspace not found, activating app only")
            activateCmux()
            return
        }
        // `whose` filtering asks cmux to find the tab itself: one round trip
        // instead of reading every tab id through Apple events (~2x faster).
        let script = """
        tell application "cmux"
            activate
            repeat with w in windows
                try
                    set t to first tab of w whose id is "\(workspace)"
                    select tab t
                    activate window w
                    return true
                end try
            end repeat
            return false
        end tell
        """
        if runAppleScript(script) == "true" {
            // `select tab` + `activate window` raise the window inside cmux but do
            // not always make cmux the frontmost app; activate it explicitly too.
            activateCmux()
            HUDLog.write(
                "cmux: jumped to \(workspace.prefix(8)) in " +
                "\(Int(Date().timeIntervalSince(started) * 1000))ms"
            )
        } else {
            HUDLog.write("cmux: tab \(workspace.prefix(8)) not selectable, activating app only")
            activateCmux()
        }
    }

    /// The cmux workspace uuid carried by the Herdr TUI process environment.
    static func herdrTUIWorkspaceID() -> String? {
        guard let pgrep = try? ProcessRunner.run("/usr/bin/pgrep", ["-x", "herdr"], timeout: 5) else {
            return nil
        }
        for raw in pgrep.stdoutText.split(whereSeparator: \.isNewline) {
            let pid = String(raw).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !pid.isEmpty else { continue }
            if let command = try? ProcessRunner.run("/bin/ps", ["-o", "command=", "-p", pid], timeout: 3) {
                let text = command.stdoutText
                if text.contains(" server") || text.contains("remote-client-bridge") || text.contains("bg-pty") {
                    continue
                }
            }
            guard let env = try? ProcessRunner.run("/bin/ps", ["-Eww", "-p", pid], timeout: 3) else {
                continue
            }
            if let workspace = envValue("CMUX_WORKSPACE_ID", in: env.stdoutText) {
                return workspace
            }
        }
        return nil
    }

    /// Activate cmux without selecting a specific tab (fallback, no Automation needed).
    static func activateCmux() {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.cmuxterm.app").first {
            if #available(macOS 14.0, *) {
                app.activate()
            } else {
                app.activate(options: [.activateIgnoringOtherApps])
            }
            return
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.cmuxterm.app") {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        }
    }

    private static func envValue(_ name: String, in text: String) -> String? {
        for token in text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }) {
            if token.hasPrefix(name + "=") {
                let value = token.dropFirst(name.count + 1)
                if !value.isEmpty { return String(value) }
            }
        }
        return nil
    }

    private static func runAppleScript(_ script: String) -> String? {
        guard let result = try? ProcessRunner.run("/usr/bin/osascript", ["-e", script], timeout: 8) else {
            HUDLog.write("cmux: osascript failed to run")
            return nil
        }
        guard result.status == 0 else {
            HUDLog.write("cmux: osascript exit \(result.status): \(result.stderrText.prefix(200))")
            return nil
        }
        return result.stdoutText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
