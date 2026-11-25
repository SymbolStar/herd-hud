import Foundation
import Combine

// MARK: - Presentation models

struct AgentRow: Identifiable, Codable {
    let id: String
    var name: String
    let kind: String
    let status: String
    let machine: String?
    let paneId: String
    let cwd: String?
    let sessionId: String?
    /// Herdr's last state-change sequence; used as a recency hint before the HUD
    /// has observed the agent itself.
    let activitySeq: Int
    /// Wall-clock of the last observed activity (state/revision/title change).
    var lastActiveAt: Date?

    var isRemote: Bool { machine != nil }

    var statusRank: Int {
        switch status {
        case "blocked": return 0
        case "working": return 1
        case "idle": return 2
        case "done": return 3
        default: return 4
        }
    }

    var isActive: Bool { status == "working" || status == "blocked" }
}

struct Counts: Codable {
    var total = 0
    var working = 0
    var blocked = 0
    var idle = 0
    /// Part of `other`: agents whose turn finished (Herdr status "done").
    var done = 0
    var other = 0
    var remote = 0
}

struct MachineView: Codable {
    let label: String
    var available: Bool
    var loading: Bool
    var error: String?
    var agentCount: Int
}

struct Board: Codable {
    var rows: [AgentRow]
    var counts: Counts
    var machines: [MachineView]
    var herdrAvailable: Bool
    var herdrError: String?
    var generatedAt: Date
    var version: String?
    var hudVersion: String?
}

struct RemoteState {
    var snapshot: Snapshot?
    var at: Date?
    var loading = false
    var error: String?
    var failures = 0
}

// MARK: - Board builder

enum BoardBuilder {
    static func build(
        config: HUDConfig,
        local: Snapshot?,
        localError: String?,
        remote: [String: RemoteState],
        activity: [String: Date] = [:],
        now: Date = Date()
    ) -> Board {
        var rows: [AgentRow] = []
        var machines: [MachineView] = []
        let builder = RowBuilder()

        if let local {
            for agent in local.agents {
                rows.append(builder.row(agent, machine: nil, snapshot: local, activity: activity))
            }
        }
        for label in config.machines {
            let state = remote[label]
            machines.append(
                MachineView(
                    label: label,
                    available: state?.snapshot != nil,
                    loading: state?.loading ?? false,
                    error: state?.error,
                    agentCount: state?.snapshot?.agents.count ?? 0
                )
            )
            if let snapshot = state?.snapshot {
                for agent in snapshot.agents {
                    rows.append(builder.row(agent, machine: label, snapshot: snapshot, activity: activity))
                }
            }
        }

        rows.sort(by: rowOrder)
        disambiguate(&rows)

        var counts = Counts()
        counts.total = rows.count
        for row in rows {
            switch row.status {
            case "working": counts.working += 1
            case "blocked": counts.blocked += 1
            case "idle": counts.idle += 1
            case "done":
                counts.done += 1
                counts.other += 1
            default: counts.other += 1
            }
            if row.isRemote { counts.remote += 1 }
        }

        return Board(
            rows: rows,
            counts: counts,
            machines: machines,
            herdrAvailable: local != nil,
            herdrError: local == nil ? (localError ?? "Herdr 未运行") : nil,
            generatedAt: now,
            version: local?.version,
            hudVersion: BuildInfo.summary
        )
    }

    private static func rowOrder(_ left: AgentRow, _ right: AgentRow) -> Bool {
        // Most recently active first; the Herdr sequence breaks ties after a
        // restart, where every agent is "first seen" at the same moment.
        let leftActive = left.lastActiveAt ?? .distantPast
        let rightActive = right.lastActiveAt ?? .distantPast
        if leftActive != rightActive { return leftActive > rightActive }
        if left.activitySeq != right.activitySeq { return left.activitySeq > right.activitySeq }
        if left.statusRank != right.statusRank { return left.statusRank < right.statusRank }
        if (left.machine == nil) != (right.machine == nil) { return left.machine == nil }
        let kinds = ["claude": 0, "opencode": 1, "codex": 2, "pi": 3]
        let leftKind = kinds[left.kind] ?? 9
        let rightKind = kinds[right.kind] ?? 9
        if leftKind != rightKind { return leftKind < rightKind }
        return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
    }

    /// Two live agents can legitimately share a name; keep rows unique for the HUD.
    private static func disambiguate(_ rows: inout [AgentRow]) {
        var counts: [String: Int] = [:]
        for row in rows { counts[row.name, default: 0] += 1 }
        for index in rows.indices where counts[rows[index].name, default: 0] > 1 {
            rows[index].name = "\(rows[index].name) · \(rows[index].paneId)"
        }
    }
}

private final class RowBuilder {
    func row(
        _ agent: RawAgent,
        machine: String?,
        snapshot: Snapshot,
        activity: [String: Date]
    ) -> AgentRow {
        let id = machine.map { "\($0)::\(agent.paneId)" } ?? agent.paneId
        return AgentRow(
            id: id,
            name: displayName(agent, snapshot: snapshot),
            kind: agent.kind,
            status: agent.status,
            machine: machine,
            paneId: agent.paneId,
            cwd: agent.cwd,
            sessionId: agent.sessionId,
            activitySeq: agent.stateChangeSeq,
            lastActiveAt: activity[id]
        )
    }

    private func displayName(_ agent: RawAgent, snapshot: Snapshot) -> String {
        var title = cleanTitle(agent.title)
        if agent.kind == "pi" { title = Self.piSessionName(title, cwd: agent.cwd) }
        if !title.isEmpty { return title }
        if let cwd = agent.cwd, !cwd.isEmpty { return (cwd as NSString).lastPathComponent }
        return agent.paneId
    }

    /// pi sets the terminal title to "π - <session name> - <cwd basename>", or
    /// "π - <cwd basename>" for an unnamed session. After `cleanTitle` drops the
    /// glyph, keep only the session name; an unnamed session yields "" so the
    /// caller falls back to the directory.
    static func piSessionName(_ title: String, cwd: String?) -> String {
        guard let cwd, !cwd.isEmpty else { return title }
        let base = (cwd as NSString).lastPathComponent
        guard !base.isEmpty else { return title }
        if title == base { return "" }
        let suffix = " - " + base
        if title.hasSuffix(suffix) {
            return String(title.dropLast(suffix.count)).trimmingCharacters(in: .whitespaces)
        }
        return title
    }

    private func cleanTitle(_ raw: String?) -> String {
        guard var text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            return ""
        }
        while let first = text.unicodeScalars.first,
              !CharacterSet.alphanumerics.contains(first) {
            text.removeFirst()
        }
        // A shell prompt like "cltx@host: ~" is not an agent name.
        if text.range(of: #"^[^\s]+@[^\s]+:"#, options: .regularExpression) != nil {
            return ""
        }
        let lower = text.lowercased()
        // pi titles look like "π - <session> - <dir>"; drop the glyph like the other agent prefixes.
        for prefix in ["opencode", "codex", "claude", "oc", "π"] where lower.hasPrefix(prefix) {
            let rest = text.dropFirst(prefix.count)
            let stripped = rest.drop { character in
                character == " " || character == "|" || character == ":" || character == "-" || character == ">"
            }
            if !stripped.isEmpty {
                text = String(stripped)
            }
            break
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Polling store

final class AgentStore: ObservableObject {
    @Published private(set) var board: Board?
    @Published private(set) var lastBoardAt: Date?
    @Published var layoutMode: HUDLayout
    /// The right-edge column can fold into a slim tab; the top strip ignores this.
    @Published private(set) var collapsed: Bool
    /// User-dragged size of the unfolded side column; nil until the first resize,
    /// so config.json keeps controlling the size until then.
    @Published private(set) var sideSize: CGSize?

    let config: HUDConfig
    private let local = HerdrSocket()
    private let pollQueue = DispatchQueue(label: "agent-hud.poll", qos: .utility)
    private let remoteQueue = DispatchQueue(label: "agent-hud.remote", qos: .utility)
    /// Clicks must not wait behind a 6–20 s remote snapshot fetch.
    private let focusQueue = DispatchQueue(label: "agent-hud.focus", qos: .userInitiated)
    private var timer: DispatchSourceTimer?
    private var remote: [String: RemoteState] = [:]
    private var lastLoggedError: String?
    private var focusProcesses: [Process] = []
    /// Last time each agent was observed changing (state/revision/title).
    private var lastActive: [String: Date] = [:]
    private var fingerprints: [String: String] = [:]
    private var activityDirty = false
    private var activitySavedAt = Date.distantPast
    private var claudeActivity: [String: Date] = [:]
    private var claudeActivityReadAt = Date.distantPast
    private static let activityKey = "AgentHUD.activity.v1"
    private static let collapsedKey = "AgentHUD.collapsed"
    private static let sideSizeKey = "AgentHUD.sideSize.v1"
    private static let activityRetention: TimeInterval = 24 * 60 * 60

    init(config: HUDConfig = .load()) {
        self.config = config
        if let saved = UserDefaults.standard.string(forKey: "AgentHUD.layout"),
           let layout = HUDLayout(rawValue: saved) {
            self.layoutMode = layout
        } else {
            self.layoutMode = config.layout
        }
        self.collapsed = UserDefaults.standard.bool(forKey: Self.collapsedKey)
        if let raw = UserDefaults.standard.string(forKey: Self.sideSizeKey) {
            let size = NSSizeFromString(raw)
            if size.width > 0, size.height > 0 { self.sideSize = size }
        }
        loadActivity()
    }

    // MARK: Claude session activity

    /// Claude Code writes `updatedAt` into ~/.claude/sessions/<pid>.json whenever
    /// a session changes state. Using it seeds the "active in the last hour" view
    /// with the real last activity of Claude agents the HUD has not observed yet.
    private func refreshClaudeActivity(_ now: Date) {
        guard now.timeIntervalSince(claudeActivityReadAt) >= 5 else { return }
        claudeActivityReadAt = now
        let directory = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".claude/sessions", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ) else {
            return
        }
        var mapping: [String: Date] = [:]
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sessionId = object["sessionId"] as? String,
                  let updatedMs = object["updatedAt"] as? Double else {
                continue
            }
            mapping[sessionId] = Date(timeIntervalSince1970: updatedMs / 1000)
        }
        claudeActivity = mapping
    }

    // MARK: persisted activity

    private func loadActivity() {
        guard let data = UserDefaults.standard.data(forKey: Self.activityKey),
              let stored = try? JSONDecoder().decode([String: Double].self, from: data) else {
            return
        }
        let cutoff = Date().addingTimeInterval(-Self.activityRetention)
        for (id, timestamp) in stored {
            let date = Date(timeIntervalSince1970: timestamp)
            if date > cutoff { lastActive[id] = date }
        }
    }

    /// Write the activity map so the "last hour" filter survives a restart.
    private func saveActivity(force: Bool) {
        let now = Date()
        if !force {
            guard activityDirty, now.timeIntervalSince(activitySavedAt) > 30 else { return }
        }
        let stored = lastActive.mapValues { $0.timeIntervalSince1970 }
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: Self.activityKey)
        }
        activityDirty = false
        activitySavedAt = now
    }

    func flushActivity() {
        pollQueue.async { [weak self] in self?.saveActivity(force: true) }
    }

    func setLayout(_ layout: HUDLayout) {
        guard layoutMode != layout else { return }
        layoutMode = layout
        UserDefaults.standard.set(layout.rawValue, forKey: "AgentHUD.layout")
        HUDLog.write("layout: \(layout.rawValue)")
    }

    func setCollapsed(_ value: Bool) {
        guard collapsed != value else { return }
        collapsed = value
        UserDefaults.standard.set(value, forKey: Self.collapsedKey)
        HUDLog.write("collapsed: \(value)")
    }

    /// Remember a size the user dragged the side column to (nil = back to config).
    func setSideSize(_ size: CGSize?) {
        guard sideSize != size else { return }
        sideSize = size
        if let size {
            UserDefaults.standard.set(NSStringFromSize(size), forKey: Self.sideSizeKey)
            HUDLog.write("side size: \(Int(size.width))x\(Int(size.height))")
        } else {
            UserDefaults.standard.removeObject(forKey: Self.sideSizeKey)
            HUDLog.write("side size: reset")
        }
    }

    func start() {
        pollQueue.async { [weak self] in
            self?.tick(forceRemote: false)
        }
        let timer = DispatchSource.makeTimerSource(queue: pollQueue)
        timer.schedule(deadline: .now() + config.refreshSeconds, repeating: config.refreshSeconds)
        timer.setEventHandler { [weak self] in
            self?.tick(forceRemote: false)
        }
        self.timer = timer
        timer.resume()
        HUDLog.write("AgentStore started (machines: \(config.machines.joined(separator: ",")))")
    }

    func refreshNow() {
        pollQueue.async { [weak self] in
            self?.tick(forceRemote: true)
        }
    }

    func focus(_ row: AgentRow) {
        let started = Date()
        HUDLog.write("focus start \(row.machine.map { "\($0)::" } ?? "")\(row.paneId)")

        // 1) Bring the Herdr workspace forward right away. This is local work
        //    (~0.1–0.3 s) and must not wait for any SSH round trip.
        focusQueue.async {
            CmuxJumper.focusHerdrWorkspace()
        }

        // 2) Focus the pane. Local Herdr answers in milliseconds; a remote
        //    `--machine` call can need seconds, so it runs in the background and
        //    lands once the SSH link answers instead of delaying the jump.
        if let machine = row.machine {
            DispatchQueue.global(qos: .userInitiated).async {
                HerdrMachineClient(label: machine).focus(row.paneId)
                HUDLog.write(
                    "focus done \(machine)::\(row.paneId) " +
                    "\(Int(Date().timeIntervalSince(started) * 1000))ms"
                )
            }
        } else {
            focusQueue.async {
                HerdrMachineClient(label: "local").focusLocal(row.paneId)
                HUDLog.write(
                    "focus done \(row.paneId) \(Int(Date().timeIntervalSince(started) * 1000))ms"
                )
            }
        }
    }

    // MARK: polling (confined to pollQueue)

    private func tick(forceRemote: Bool) {
        let now = Date()
        refreshClaudeActivity(now)
        var localSnapshot: Snapshot?
        var localError: String?
        do {
            localSnapshot = try local.snapshot()
        } catch {
            localError = String(describing: error)
        }
        if let localError, localError != lastLoggedError {
            HUDLog.write("local herdr unavailable: \(localError)")
            lastLoggedError = localError
        } else if localSnapshot != nil {
            lastLoggedError = nil
        }

        for label in config.machines {
            var state = remote[label] ?? RemoteState()
            // Back off exponentially while a machine is unreachable so a down
            // host does not spawn an SSH attempt every few seconds.
            let interval: TimeInterval
            if state.error == nil {
                interval = config.remoteRefreshSeconds
            } else {
                interval = min(60, 8 * pow(2, Double(max(0, state.failures - 1))))
            }
            let stale = state.at.map { now.timeIntervalSince($0) > interval } ?? true
            if !state.loading && (forceRemote || stale) {
                state.loading = true
                remote[label] = state
                fetchRemote(label, base: state)
            }
        }

        publish(local: localSnapshot, localError: localError, now: now)
    }

    private func fetchRemote(_ label: String, base: RemoteState) {
        remoteQueue.async { [weak self] in
            guard let self else { return }
            let client = HerdrMachineClient(label: label)
            var state = base
            do {
                let snapshot = try client.snapshot()
                state.snapshot = snapshot
                state.at = Date()
                state.loading = false
                state.error = nil
                state.failures = 0
            } catch {
                state.loading = false
                state.error = String(describing: error)
                state.at = Date()
                state.failures += 1
                if state.failures == 1 || state.failures % 5 == 0 {
                    HUDLog.write("remote \(label) failed (attempt \(state.failures)): \(state.error ?? "")")
                }
            }
            self.pollQueue.async {
                self.remote[label] = state
                self.publish(local: nil, localError: nil, now: Date(), reuseLocal: true)
            }
        }
    }

    private var cachedLocal: Snapshot?
    private var cachedLocalError: String?

    /// Track when each agent last changed: status, terminal revision, title or
    /// Herdr state sequence. This is what "recently active" orders by; Herdr's
    /// state sequence only seeds the order until the HUD observes a change.
    private func observeActivity(local: Snapshot?, remote: [String: RemoteState], now: Date) {
        var seen = Set<String>()

        func observe(_ agent: RawAgent, id: String) {
            seen.insert(id)
            let fingerprint = "\(agent.status)|\(agent.revision)|\(agent.stateChangeSeq)|\(agent.title ?? "")"
            defer { fingerprints[id] = fingerprint }
            guard let previous = fingerprints[id] else {
                return
            }
            if previous != fingerprint {
                lastActive[id] = now
                activityDirty = true
            }
        }

        if let local {
            for agent in local.agents {
                observe(agent, id: agent.paneId)
                if agent.kind == "claude", let sessionId = agent.sessionId,
                   let updated = claudeActivity[sessionId] {
                    let current = lastActive[agent.paneId] ?? .distantPast
                    if updated > current {
                        lastActive[agent.paneId] = updated
                        activityDirty = true
                    }
                }
            }
        }
        for (label, state) in remote {
            for agent in state.snapshot?.agents ?? [] {
                observe(agent, id: "\(label)::\(agent.paneId)")
            }
        }

        // Forget agents that have been gone for a while; keep the maps bounded.
        let cutoff = now.addingTimeInterval(-24 * 60 * 60)
        for (id, at) in lastActive where !seen.contains(id) && at < cutoff {
            lastActive.removeValue(forKey: id)
            fingerprints.removeValue(forKey: id)
        }
    }

    func relativeActivity(_ row: AgentRow) -> String? {
        guard let at = row.lastActiveAt else { return nil }
        return HUDFormat.relative(at, now: Date())
    }

    private func publish(
        local: Snapshot?,
        localError: String?,
        now: Date,
        reuseLocal: Bool = false
    ) {
        if !reuseLocal {
            cachedLocal = local
            cachedLocalError = localError
        }
        observeActivity(local: cachedLocal, remote: remote, now: now)
        saveActivity(force: false)
        let board = BoardBuilder.build(
            config: config,
            local: cachedLocal,
            localError: cachedLocalError,
            remote: remote,
            activity: lastActive,
            now: now
        )
        DispatchQueue.main.async { [weak self] in
            self?.board = board
            self?.lastBoardAt = board.generatedAt
        }
    }
}

// MARK: - One-shot dump (for debugging and CI-less checks)

enum DumpMode {
    static func run(config: HUDConfig, includeRemote: Bool = true) -> String {
        var localSnapshot: Snapshot?
        var localError: String?
        do {
            localSnapshot = try HerdrSocket().snapshot()
        } catch {
            localError = String(describing: error)
        }
        var remote: [String: RemoteState] = [:]
        if includeRemote {
            for label in config.machines {
                var state = RemoteState()
                do {
                    state.snapshot = try HerdrMachineClient(label: label).snapshot()
                    state.at = Date()
                } catch {
                    state.error = String(describing: error)
                }
                remote[label] = state
            }
        }
        let board = BoardBuilder.build(
            config: config,
            local: localSnapshot,
            localError: localError,
            remote: remote
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(board),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"failed to encode board\"}"
        }
        return text
    }
}
