// Unit tests for the pure logic behind the HUD.
//
// Named main.swift because swiftc only allows top-level code there; it is the
// test entry point and never ships in the app bundle.
//
// Compiled together with Sources/*.swift (minus main.swift) by `test.sh`, so
// the tests see the same code the app ships. No XCTest: the app has no Xcode
// project, and a plain runner keeps `swiftc` as the only requirement.

import Foundation

// MARK: - Tiny harness

private var failures = 0
private var checks = 0

private func check(_ condition: Bool, _ message: String) {
    checks += 1
    if !condition {
        failures += 1
        print("  FAIL  \(message)")
    }
}

private func checkEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) {
    checks += 1
    if actual != expected {
        failures += 1
        print("  FAIL  \(message)\n          expected: \(expected)\n          actual:   \(actual)")
    }
}

private func section(_ name: String) {
    print("- \(name)")
}

// MARK: - Fixtures

private func rawAgent(
    _ paneId: String,
    kind: String = "pi",
    status: String = "idle",
    cwd: String? = nil,
    title: String? = nil,
    workspaceId: String? = nil,
    seq: Int = 0
) -> RawAgent {
    RawAgent(
        paneId: paneId,
        kind: kind,
        status: status,
        cwd: cwd,
        title: title,
        sessionId: nil,
        workspaceId: workspaceId,
        stateChangeSeq: seq,
        revision: 1
    )
}

private func snapshot(_ agents: [RawAgent], workspaces: [String: String] = [:]) -> Snapshot {
    Snapshot(version: "0.9.5", protocolVersion: 22, agents: agents, workspaces: workspaces, tabs: [:])
}

private func board(
    _ agents: [RawAgent],
    workspaces: [String: String] = [:],
    activity: [String: Date] = [:]
) -> Board {
    BoardBuilder.build(
        config: .default,
        local: snapshot(agents, workspaces: workspaces),
        localError: nil,
        remote: [:],
        activity: activity,
        now: Date(timeIntervalSince1970: 0)
    )
}

private func agentRow(
    _ paneId: String,
    name: String? = nil,
    status: String = "idle",
    workspace: String? = nil,
    seq: Int = 0
) -> AgentRow {
    AgentRow(
        id: paneId,
        name: name ?? paneId,
        kind: "pi",
        status: status,
        machine: nil,
        paneId: paneId,
        cwd: nil,
        sessionId: nil,
        workspace: workspace,
        activitySeq: seq,
        lastActiveAt: nil
    )
}

// MARK: - Agent naming

section("agent naming")
do {
    let b = board([
        rawAgent("w5:p1", cwd: "/Users/me/gongchenhao", title: "π - litellm额度 - gongchenhao"),
    ])
    checkEqual(b.rows.first?.name, "litellm额度", "pi session name drops the glyph and the trailing directory")

    let b2 = board([
        rawAgent("w7:p3", cwd: "/Users/me/carher-runtime", title: "π - runtime flow - regression - carher-runtime"),
    ])
    checkEqual(b2.rows.first?.name, "runtime flow - regression", "a session name containing separators keeps them")

    let b3 = board([
        rawAgent("w7:p1", cwd: "/Users/me/carher-runtime", title: "π - carher-runtime"),
    ])
    // Note: `piSessionName` returns "" here and `displayName` falls back to the
    // directory, so the name is the directory either way. This documents the
    // user-visible result rather than guarding one branch.
    checkEqual(b3.rows.first?.name, "carher-runtime", "an unnamed pi session shows the directory")

    let b4 = board([
        rawAgent("w1:p1", cwd: "/tmp/x", title: "custom title"),
    ])
    checkEqual(b4.rows.first?.name, "custom title", "a title that is not a pi session string is kept as is")

    let b5 = board([
        rawAgent("w1:p1", cwd: "/tmp/x", title: nil),
        rawAgent("w1:p2", cwd: "/tmp/x", title: nil),
    ])
    checkEqual(
        b5.rows.map(\.name).sorted(),
        ["x · w1:p1", "x · w1:p2"],
        "duplicate names are disambiguated with the pane id"
    )
}

// MARK: - Counts and ordering

section("counts and ordering")
do {
    let b = board([
        rawAgent("w1:p1", status: "idle", seq: 10),
        rawAgent("w1:p2", status: "working", seq: 20),
        rawAgent("w1:p3", status: "blocked", seq: 30),
        rawAgent("w1:p4", status: "done", seq: 40),
        rawAgent("w1:p5", status: "unknown", seq: 50),
    ])
    checkEqual(b.counts.total, 5, "total counts every row")
    checkEqual(b.counts.blocked, 1, "blocked count")
    checkEqual(b.counts.working, 1, "working count")
    checkEqual(b.counts.idle, 1, "idle count")
    checkEqual(b.counts.done, 1, "done count")
    checkEqual(b.counts.other, 2, "other holds done and unknown")
    checkEqual(b.rows.first(where: { $0.status == "blocked" })?.isActive, true, "blocked counts as active")
    checkEqual(b.rows.first(where: { $0.status == "working" })?.isActive, true, "working counts as active")
    checkEqual(b.rows.first(where: { $0.status == "idle" })?.isActive, false, "idle is not active")
    checkEqual(b.rows.first(where: { $0.status == "done" })?.isActive, false, "done is not active")
}

section("status ranking")
do {
    // Equal activity: the sequence cannot break the tie, so status ranks.
    let b = board([
        rawAgent("w1:p1", status: "idle"),
        rawAgent("w1:p2", status: "working"),
        rawAgent("w1:p3", status: "blocked"),
        rawAgent("w1:p4", status: "done"),
        rawAgent("w1:p5", status: "unknown"),
    ])
    checkEqual(
        b.rows.map(\.status),
        ["blocked", "working", "idle", "done", "unknown"],
        "with equal recency rows sort blocked, working, idle, then the rest"
    )
}

section("recency")
do {
    // No observed activity: Herdr's sequence decides, newest first.
    let b = board([
        rawAgent("w1:p1", status: "idle", seq: 100),
        rawAgent("w1:p2", status: "idle", seq: 300),
        rawAgent("w1:p3", status: "idle", seq: 200),
    ])
    checkEqual(b.rows.map(\.paneId), ["w1:p2", "w1:p3", "w1:p1"], "equal status falls back to the herdr sequence")
}

do {
    // Observed activity outranks the sequence: the HUD has seen w1:p1 change
    // more recently even though w1:p2 has the higher Herdr sequence.
    let b = board(
        [
            rawAgent("w1:p1", status: "idle", seq: 100),
            rawAgent("w1:p2", status: "idle", seq: 300),
        ],
        activity: ["w1:p1": Date(timeIntervalSince1970: 900)]
    )
    checkEqual(b.rows.map(\.paneId), ["w1:p1", "w1:p2"], "observed activity outranks the herdr sequence")
    checkEqual(b.rows.first?.lastActiveAt, Date(timeIntervalSince1970: 900), "the activity timestamp is carried onto the row")
}

// MARK: - Workspace resolution

section("workspace resolution")
do {
    let b = board(
        [
            rawAgent("w1:p1", workspaceId: "w1"),
            rawAgent("w2:p1", workspaceId: "w2"),
            rawAgent("w9:p1", workspaceId: nil),
            rawAgent("w9:p2", workspaceId: "missing"),
        ],
        workspaces: ["w1": "alpha", "w2": "beta"]
    )
    checkEqual(
        b.rows.map(\.workspace),
        ["alpha", "beta", nil, nil],
        "known workspace ids resolve to labels; unknown or absent ids stay nil"
    )
}

// MARK: - Grouping

section("grouping")
do {
    checkEqual(WorkspaceGrouping.groups(from: []).count, 0, "no rows gives no groups")

    let onlyFallback = WorkspaceGrouping.groups(from: [agentRow("p1"), agentRow("p2")])
    checkEqual(onlyFallback.map(\.workspace), ["其他"], "rows without a workspace form one fallback group")
    checkEqual(onlyFallback.first?.rows.count, 2, "the fallback group keeps both rows")
}

do {
    // The fallback row is the most recent, so a naive first-seen grouping would
    // put it first.
    let rows = [
        agentRow("p9", status: "idle", workspace: nil, seq: 900),
        agentRow("p1", workspace: "alpha", seq: 500),
        agentRow("p2", workspace: "beta", seq: 100),
    ]
    let groups = WorkspaceGrouping.groups(from: rows)
    checkEqual(groups.map(\.workspace), ["alpha", "beta", "其他"], "the fallback group always sorts last")
    checkEqual(groups.last?.rows.map(\.paneId), ["p9"], "the fallback group keeps its rows")
}

do {
    // Within-group order must match the incoming board order.
    let rows = [
        agentRow("a1", workspace: "alpha", seq: 300),
        agentRow("b1", workspace: "beta", seq: 200),
        agentRow("a2", workspace: "alpha", seq: 100),
        agentRow("a3", workspace: "alpha", seq: 50),
    ]
    let groups = WorkspaceGrouping.groups(from: rows)
    checkEqual(groups.map(\.workspace), ["alpha", "beta"], "groups keep first-seen order")
    checkEqual(groups.first?.rows.map(\.paneId) ?? [], ["a1", "a2", "a3"], "within-group order is preserved")
    checkEqual(groups.dropFirst().first?.rows.map(\.paneId) ?? [], ["b1"], "each group gets only its own rows")

    let totalRows = groups.reduce(0) { $0 + $1.rows.count }
    checkEqual(totalRows, rows.count, "grouping never drops a row")
}

do {
    let rows = [agentRow("p1", workspace: "alpha", seq: 10), agentRow("p2", workspace: nil, seq: 20)]
    checkEqual(
        WorkspaceGrouping.groups(from: rows).map(\.workspace),
        ["alpha", "其他"],
        "a fallback that is already last keeps its place"
    )
}

do {
    // Two agents without a workspace plus one workspace: the fallback must not
    // be duplicated or reordered away.
    let rows = [
        agentRow("p9", workspace: nil, seq: 30),
        agentRow("p1", workspace: "alpha", seq: 20),
        agentRow("p8", workspace: nil, seq: 10),
    ]
    let groups = WorkspaceGrouping.groups(from: rows)
    checkEqual(groups.map(\.workspace), ["alpha", "其他"], "fallback stays a single group, last")
    checkEqual(groups.dropFirst().first?.rows.map(\.paneId) ?? [], ["p9", "p8"], "fallback rows keep board order")
}

section("remote machines")
do {
    var channel = RemoteState()
    channel.snapshot = snapshot([rawAgent("wr:p1", status: "working")])
    let b = BoardBuilder.build(
        config: .default,
        local: snapshot([rawAgent("w1:p1", status: "idle")]),
        localError: nil,
        remote: ["symbol-150-jms": channel],
        now: Date(timeIntervalSince1970: 0)
    )
    checkEqual(
        b.rows.map(\.id).sorted(),
        ["symbol-150-jms::wr:p1", "w1:p1"],
        "remote rows keep the machine prefix in their id"
    )
    checkEqual(b.counts.remote, 1, "remote count")
    checkEqual(b.counts.total, 2, "total includes remote rows")
    checkEqual(b.rows.first(where: { $0.isRemote })?.machine, "symbol-150-jms", "remote rows carry their machine label")
}

do {
    // Same status and activity, so the machine check decides. The remote pane
    // id is chosen so the *name* tie-breaker would put it first: if the
    // local-before-remote rule were removed, this assertion would fail.
    var channel = RemoteState()
    channel.snapshot = snapshot([rawAgent("w0:p1", status: "idle")])
    let b = BoardBuilder.build(
        config: .default,
        local: snapshot([rawAgent("w1:p1", status: "idle")]),
        localError: nil,
        // Only machines listed in the config contribute rows.
        remote: ["symbol-150-jms": channel],
        now: Date(timeIntervalSince1970: 0)
    )
    checkEqual(
        b.rows.map(\.id),
        ["w1:p1", "symbol-150-jms::w0:p1"],
        "local rows sort ahead of remote rows on a tie"
    )
}

section("kind ordering")
do {
    // Equal status, activity and sequence: the kind order breaks the tie.
    let b = board([
        rawAgent("w1:p1", kind: "pi"),
        rawAgent("w1:p2", kind: "claude"),
        rawAgent("w1:p3", kind: "codex"),
        rawAgent("w1:p4", kind: "opencode"),
        rawAgent("w1:p5", kind: "other-agent"),
    ])
    checkEqual(
        b.rows.map(\.kind),
        ["claude", "opencode", "codex", "pi", "other-agent"],
        "kinds sort claude, opencode, codex, pi, then anything else"
    )
}

// MARK: - Layout modes

section("layout")
do {
    checkEqual(HUDLayout(rawValue: "vertical"), .vertical, "vertical parses")
    checkEqual(HUDLayout(rawValue: "horizontal"), .horizontal, "horizontal parses")
    checkEqual(HUDLayout(rawValue: "diagonal"), nil, "an unknown layout is rejected")
}

// MARK: - Result

print("")
if failures == 0 {
    print("HUDCoreTests: all \(checks) assertions passed")
    exit(0)
} else {
    print("HUDCoreTests: \(failures) of \(checks) assertions FAILED")
    exit(1)
}
