import SwiftUI
import AppKit

// MARK: - Palette

enum HUDTheme {
    static let working = Color(red: 0.30, green: 0.86, blue: 0.55)
    static let blocked = Color(red: 1.00, green: 0.73, blue: 0.32)
    static let idle = Color.white.opacity(0.35)
    static let done = Color(red: 0.47, green: 0.64, blue: 1.00)
    static let unknown = Color.white.opacity(0.28)
    static let claude = Color(red: 0.64, green: 0.56, blue: 0.99)
    static let opencode = Color(red: 0.36, green: 0.83, blue: 0.62)
    static let codex = Color(red: 1.00, green: 0.74, blue: 0.38)
    static let pi = Color(red: 0.40, green: 0.72, blue: 1.00)

    static func status(_ value: String) -> Color {
        switch value {
        case "working": return working
        case "blocked": return blocked
        case "done": return done
        case "unknown": return unknown
        default: return idle
        }
    }

    static func kind(_ value: String) -> Color {
        switch value {
        case "claude": return claude
        case "opencode": return opencode
        case "codex": return codex
        case "pi": return pi
        default: return unknown
        }
    }
}

// MARK: - Root panel

struct PanelView: View {
    @ObservedObject var store: AgentStore
    /// Configured column width; a user-dragged size overrides it.
    let configuredWidth: CGFloat
    @State private var showAll = false
    @State private var horizontalAll = false
    /// Workspace labels the user has folded; persisted in UserDefaults.
    @State private var collapsedWorkspaces: Set<String> = {
        let saved = UserDefaults.standard.stringArray(forKey: "AgentHUD.collapsedWorkspaces") ?? []
        return Set(saved)
    }()

    private var board: Board? { store.board }

    private var width: CGFloat { store.sideSize?.width ?? configuredWidth }

    private var compact: Bool { width < 220 }

    /// The board rows are already ordered by most recent activity; show the
    /// latest seven unless the user asks for everything.
    private static let recentLimit = 10

    private var rows: [AgentRow] {
        guard let board else { return [] }
        if showAll { return board.rows }
        return Array(board.rows.prefix(Self.recentLimit))
    }

    private var horizontalRows: [AgentRow] {
        guard let board else { return [] }
        if horizontalAll { return board.rows }
        return Array(board.rows.prefix(Self.recentLimit))
    }

    /// Width of the folded side tab; the controller sizes the window to match.
    static let collapsedWidth: CGFloat = 34
    static let collapsedHeight: CGFloat = 150

    private var isCollapsedTab: Bool { store.layoutMode == .vertical && store.collapsed }

    var body: some View {
        Group {
            if isCollapsedTab {
                collapsedBody
                    .frame(width: Self.collapsedWidth)
                    .frame(maxHeight: .infinity)
            } else if store.layoutMode == .vertical {
                verticalBody
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                horizontalBody
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .background(
            VisualEffectView()
                .overlay(Color.black.opacity(0.18))
        )
        .clipShape(RoundedRectangle(cornerRadius: isCollapsedTab ? 10 : 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: isCollapsedTab ? 10 : 14, style: .continuous)
                .stroke(Color.white.opacity(0.10), lineWidth: 0.5)
        )
        .environment(\.colorScheme, .dark)
    }

    // MARK: vertical (right edge)

    private var verticalBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            divider
            verticalContent
            divider
            verticalFooter
        }
    }

    private var header: some View {
        HStack(spacing: compact ? 5 : 8) {
            Text("AGENTS")
                .font(.system(size: compact ? 8.5 : 10, weight: .bold))
                .tracking(compact ? 0.6 : 1.6)
                .foregroundStyle(Color.white.opacity(0.55))
                .lineLimit(1)
            Spacer(minLength: 2)
            countsInline
            layoutButton
            collapseButton
        }
        .padding(.horizontal, compact ? 9 : 12)
        .padding(.vertical, compact ? 8 : 10)
    }

    private var collapseButton: some View {
        Button {
            store.setCollapsed(true)
        } label: {
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.4))
                .frame(width: 14, height: 14)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("折叠到屏幕边")
    }

    // MARK: collapsed side tab

    /// A slim tab that keeps the live counts visible; click anywhere to unfold.
    /// Each count is a coloured disc with the number inside; zero counts are
    /// hidden so the tab only shows what needs attention.
    private var collapsedBody: some View {
        VStack(spacing: 7) {
            Image(systemName: "chevron.left")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.45))
            if let board {
                ForEach(collapsedBadges(board.counts), id: \.label) { badge in
                    countDisc(badge.value, color: badge.color)
                }
                if !board.herdrAvailable {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(HUDTheme.blocked)
                }
            } else {
                ProgressView().controlSize(.mini)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { store.setCollapsed(false) }
        .help(collapsedHelp)
    }

    private struct CountBadge {
        let label: String
        let value: Int
        let color: Color
    }

    /// Order: waiting for you, running, finished, idle. The running disc is
    /// always shown (0 included) so the tab never reads as empty; the others
    /// appear only when their count is non-zero. The idle disc uses a solid
    /// white rather than the translucent row dot so its number stays legible.
    private func collapsedBadges(_ counts: Counts) -> [CountBadge] {
        [
            CountBadge(label: "blocked", value: counts.blocked, color: HUDTheme.blocked),
            CountBadge(label: "working", value: counts.working, color: HUDTheme.working),
            CountBadge(label: "done", value: counts.done, color: HUDTheme.done),
            CountBadge(label: "idle", value: counts.idle, color: Color.white.opacity(0.82)),
        ].filter { $0.value > 0 || $0.label == "working" }
    }

    private func countDisc(_ value: Int, color: Color) -> some View {
        Text(value > 99 ? "99+" : String(value))
            .font(.system(size: value > 9 ? 9.5 : 11, weight: .bold).monospacedDigit())
            .foregroundStyle(Color.black.opacity(0.78))
            .frame(width: 22, height: 22)
            .background(Circle().fill(color))
            .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 0.5))
    }

    private var collapsedHelp: String {
        guard let board else { return "展开 Agent HUD" }
        let c = board.counts
        return "展开 Agent HUD · \(c.blocked) 等待确认 / \(c.working) 运行中 / \(c.done) 已完成 / \(c.idle) 空闲 / \(c.total) 个"
    }

    @ViewBuilder
    private var countsInline: some View {
        if let board {
            countPill(board.counts.working, color: HUDTheme.working)
            if board.counts.blocked > 0 {
                countPill(board.counts.blocked, color: HUDTheme.blocked)
            }
            if !board.herdrAvailable {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(HUDTheme.blocked)
                    .help("Herdr 未连接")
            }
        }
    }

    private var layoutButton: some View {
        Button {
            store.setLayout(store.layoutMode == .vertical ? .horizontal : .vertical)
        } label: {
            Text(store.layoutMode == .vertical ? "顶部" : "侧边")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.4))
        }
        .buttonStyle(.plain)
        .help(store.layoutMode == .vertical ? "变成顶部横向条" : "变成右侧竖列")
    }

    private func countPill(_ value: Int, color: Color) -> some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(String(value))
                .font(.system(size: compact ? 10 : 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.white.opacity(0.85))
        }
    }

    /// Label for agents that have no Herdr workspace; a fallback bucket.
    private static let noWorkspaceLabel = "其他"

    /// One workspace's agents, in the order they appear on the board.
    private struct WorkspaceGroup: Identifiable {
        let workspace: String
        var rows: [AgentRow]
        var id: String { workspace }
    }

    /// Group rows by workspace label, preserving the within-group order from
    /// the board (most recently active first). Agents without a workspace are a
    /// fallback bucket and always come last, however recent they are.
    private static func groupByWorkspace(_ rows: [AgentRow]) -> [WorkspaceGroup] {
        var groups: [WorkspaceGroup] = []
        var index: [String: Int] = [:]
        for row in rows {
            let key = row.workspace ?? Self.noWorkspaceLabel
            if let i = index[key] {
                groups[i].rows.append(row)
            } else {
                index[key] = groups.count
                groups.append(WorkspaceGroup(workspace: key, rows: [row]))
            }
        }
        // Groups appear in activity order, so the fallback bucket can land
        // anywhere; move it to the end where it belongs.
        if let fallback = groups.firstIndex(where: { $0.workspace == Self.noWorkspaceLabel }),
           fallback != groups.count - 1 {
            groups.append(groups.remove(at: fallback))
        }
        return groups
    }

    private var groupedRows: [WorkspaceGroup] { Self.groupByWorkspace(rows) }

    private var horizontalGroups: [WorkspaceGroup] { Self.groupByWorkspace(horizontalRows) }

    @ViewBuilder
    private var verticalContent: some View {
        if let board {
            if rows.isEmpty {
                emptyState(board)
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(groupedRows) { group in
                            let isCollapsed = collapsedWorkspaces.contains(group.workspace)
                            workspaceSectionHeader(group.workspace, count: group.rows.count, collapsed: isCollapsed)
                            if !isCollapsed {
                                ForEach(group.rows) { row in
                                    AgentRowView(row: row, compact: compact) { store.focus(row) }
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                if !showAll && !board.rows.isEmpty {
                    revealAllButton(board)
                }
            }
        } else {
            loadingState
        }
    }

    private func workspaceSectionHeader(_ label: String, count: Int, collapsed: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                .font(.system(size: compact ? 7 : 8, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.30))
                .frame(width: 10)
            Text(label)
                .font(.system(size: compact ? 9 : 10, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.45))
                .lineLimit(1)
            Text(String(count))
                .font(.system(size: compact ? 8 : 9, weight: .medium).monospacedDigit())
                .foregroundStyle(Color.white.opacity(0.30))
            Spacer()
        }
        .padding(.horizontal, compact ? 9 : 12)
        .padding(.top, 10)
        .padding(.bottom, 2)
        .contentShape(Rectangle())
        .onTapGesture { toggleWorkspace(label) }
    }

    private func toggleWorkspace(_ label: String) {
        if collapsedWorkspaces.contains(label) {
            collapsedWorkspaces.remove(label)
        } else {
            collapsedWorkspaces.insert(label)
        }
        UserDefaults.standard.set(Array(collapsedWorkspaces), forKey: "AgentHUD.collapsedWorkspaces")
    }

    private func emptyState(_ board: Board) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 18, weight: .light))
                .foregroundStyle(Color.white.opacity(0.35))
            Text(board.rows.isEmpty ? "没有在运行的 agent" : "没有活跃 agent")
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.55))
            if !board.rows.isEmpty {
                Button("显示全部 \(board.counts.total) 个") { showAll = true }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(HUDTheme.claude)
            }
            if let error = board.herdrError {
                Text(error)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.white.opacity(0.35))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
    }

    private var loadingState: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("正在读取 Herdr…")
                .font(.system(size: 11))
                .foregroundStyle(Color.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 22)
    }

    private func revealAllButton(_ board: Board) -> some View {
        Button {
            showAll = true
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
                Text("显示全部 \(board.counts.total) 个")
                    .font(.system(size: compact ? 9.5 : 10.5, weight: .medium))
            }
            .foregroundStyle(Color.white.opacity(0.45))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var verticalFooter: some View {
        HStack(spacing: compact ? 5 : 8) {
            filterButton
            Spacer(minLength: 2)
            if let board, !board.machines.isEmpty {
                ForEach(board.machines, id: \.label) { machine in
                    if compact {
                        Circle()
                            .fill(machineColor(machine))
                            .frame(width: 5, height: 5)
                            .help("\(machine.label) \(machine.error ?? "\(machine.agentCount) 个 agent")")
                    } else {
                        machinePill(machine)
                    }
                }
            }
            if let board, let error = board.herdrError, !compact {
                Text("Herdr 未连接")
                    .font(.system(size: 9.5))
                    .foregroundStyle(HUDTheme.blocked.opacity(0.85))
                    .lineLimit(1)
                    .help(error)
            }
            Text(HUDFormat.clock(board?.generatedAt))
                .font(.system(size: compact ? 8.5 : 9.5).monospacedDigit())
                .foregroundStyle(Color.white.opacity(0.30))
        }
        .padding(.horizontal, compact ? 9 : 12)
        .padding(.vertical, compact ? 6 : 7)
    }

    private func machineColor(_ machine: MachineView) -> Color {
        if machine.available { return HUDTheme.working }
        return machine.error != nil ? Color(red: 1.0, green: 0.42, blue: 0.38) : HUDTheme.blocked
    }

    private var filterButton: some View {
        Button {
            showAll.toggle()
        } label: {
            Text(showAll ? "全部" : "最近10")
                .font(.system(size: compact ? 9 : 10, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.55))
        }
        .buttonStyle(.plain)
        .help(showAll ? "只显示最近活跃的 10 个 agent" : "显示全部 agent")
    }

    private func machinePill(_ machine: MachineView) -> some View {
        let color: Color = machine.available
            ? HUDTheme.working
            : (machine.error != nil ? Color(red: 1.0, green: 0.42, blue: 0.38) : HUDTheme.blocked)
        let suffix = machine.available ? "" : (machine.loading ? "…" : "×")
        return HStack(spacing: 3) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text(machine.label + suffix)
                .font(.system(size: 9.5, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.45))
                .lineLimit(1)
        }
        .help(machine.error ?? "\(machine.agentCount) 个 agent")
    }

    // MARK: horizontal (top edge)

    private var horizontalBody: some View {
        HStack(spacing: 10) {
            Text("AGENTS")
                .font(.system(size: 10, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.55))

            countsInline

            verticalRule

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if let board {
                        if horizontalRows.isEmpty {
                            Text(board.rows.isEmpty ? "没有在运行的 agent" : "没有活跃 agent")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.white.opacity(0.45))
                                .padding(.horizontal, 4)
                        } else {
                            ForEach(Array(horizontalGroups.enumerated()), id: \.element.id) { index, group in
                                if index > 0 { horizontalGroupSeparator }
                                Text(group.workspace)
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(Color.white.opacity(0.40))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: 90, alignment: .leading)
                                    .help(group.workspace)
                                ForEach(group.rows) { row in
                                    AgentChipView(row: row) { store.focus(row) }
                                }
                            }
                        }
                    } else {
                        Text("正在读取 Herdr…")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.white.opacity(0.45))
                    }
                }
                .padding(.vertical, 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            verticalRule

            if let board {
                ForEach(board.machines, id: \.label) { machine in
                    machinePill(machine)
                }
            }

            horizontalFilterButton
            layoutButton
            Text(HUDFormat.clock(board?.generatedAt))
                .font(.system(size: 9).monospacedDigit())
                .foregroundStyle(Color.white.opacity(0.30))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(maxHeight: .infinity)
    }

    /// Thin rule between workspace groups in the top strip.
    private var horizontalGroupSeparator: some View {
        Rectangle()
            .fill(Color.white.opacity(0.12))
            .frame(width: 1, height: 18)
            .padding(.horizontal, 2)
    }

    private var horizontalFilterButton: some View {
        Button {
            horizontalAll.toggle()
        } label: {
            Text(horizontalAll ? "全部" : "最近10")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.5))
        }
        .buttonStyle(.plain)
        .help(horizontalAll ? "只显示最近活跃的 10 个 agent" : "显示全部 agent")
    }

    private var divider: some View {
        Rectangle().fill(Color.white.opacity(0.08)).frame(height: 0.5)
    }

    private var verticalRule: some View {
        Rectangle().fill(Color.white.opacity(0.08)).frame(width: 0.5)
    }
}

// MARK: - Vertical row

struct AgentRowView: View {
    let row: AgentRow
    var compact: Bool = false
    let onTap: () -> Void
    @State private var hovering = false

    private var statusColor: Color { HUDTheme.status(row.status) }

    var body: some View {
        Group {
            if compact {
                compactBody
            } else {
                regularBody
            }
        }
    }

    private var compactBody: some View {
        HStack(spacing: 6) {
            PulseDot(color: statusColor, pulsing: row.isActive)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineLimit(1)
                    .truncationMode(.middle)
                HStack(spacing: 4) {
                    Text(statusLabel)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(statusColor.opacity(0.9))
                    Spacer(minLength: 0)
                    if let relative = HUDFormat.relative(row.lastActiveAt) {
                        Text(relative)
                            .font(.system(size: 8.5, weight: .medium).monospacedDigit())
                            .foregroundStyle(Color.white.opacity(0.30))
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(hovering ? Color.white.opacity(0.06) : Color.clear)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { onTap() }
        .help("点击跳到 Herdr · \(row.id)")
    }

    private var regularBody: some View {
        HStack(spacing: 8) {
            PulseDot(color: statusColor, pulsing: row.isActive)
            VStack(alignment: .leading, spacing: 1.5) {
                HStack(spacing: 5) {
                    Text(row.name)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.92))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    kindBadge
                    if let machine = row.machine {
                        machineBadge(machine)
                    }
                }
                HStack(spacing: 6) {
                    Text(statusLabel)
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(statusColor.opacity(0.9))
                    if let cwd = row.cwd, !cwd.isEmpty {
                        Text((cwd as NSString).lastPathComponent)
                            .font(.system(size: 9.5))
                            .foregroundStyle(Color.white.opacity(0.32))
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 4)
            if let relative = HUDFormat.relative(row.lastActiveAt) {
                Text(relative)
                    .font(.system(size: 9.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(Color.white.opacity(0.28))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(hovering ? Color.white.opacity(0.06) : Color.clear)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { onTap() }
        .help("点击跳到 Herdr · \(row.id)")
    }

    private var kindBadge: some View {
        Text(kindLetter(row.kind))
            .font(.system(size: 8.5, weight: .bold))
            .foregroundStyle(HUDTheme.kind(row.kind))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(HUDTheme.kind(row.kind).opacity(0.14))
            .clipShape(Capsule())
    }

    private func kindLetter(_ kind: String) -> String {
        switch kind {
        case "claude": return "C"
        case "opencode": return "OC"
        case "codex": return "CX"
        case "pi": return "π"
        default: return "?"
        }
    }

    private func machineBadge(_ machine: String) -> some View {
        Text(machine)
            .font(.system(size: 8.5, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.45))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Color.white.opacity(0.07))
            .clipShape(Capsule())
            .lineLimit(1)
    }

    private var statusLabel: String {
        switch row.status {
        case "working": return "运行中"
        case "blocked": return "等待确认"
        case "idle": return "空闲"
        case "done": return "完成"
        default: return "未知"
        }
    }
}

// MARK: - Horizontal chip

struct AgentChipView: View {
    let row: AgentRow
    let onTap: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            PulseDot(color: HUDTheme.status(row.status), pulsing: row.isActive)
            Text(row.name)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.9))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 150, alignment: .leading)
            Text(kindLetter)
                .font(.system(size: 8.5, weight: .bold))
                .foregroundStyle(HUDTheme.kind(row.kind))
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(HUDTheme.kind(row.kind).opacity(0.14))
                .clipShape(Capsule())
            if let machine = row.machine {
                Text(machine)
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.white.opacity(0.07))
                    .clipShape(Capsule())
                    .lineLimit(1)
            }
            Text(statusLabel)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(HUDTheme.status(row.status).opacity(0.9))
            if let relative = HUDFormat.relative(row.lastActiveAt) {
                Text(relative)
                    .font(.system(size: 9, weight: .medium).monospacedDigit())
                    .foregroundStyle(Color.white.opacity(0.28))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Color.white.opacity(hovering ? 0.09 : 0.05))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { onTap() }
        .help("点击跳到 Herdr · \(row.id)")
    }

    private var kindLetter: String {
        switch row.kind {
        case "claude": return "C"
        case "opencode": return "OC"
        case "codex": return "CX"
        case "pi": return "π"
        default: return "?"
        }
    }

    private var statusLabel: String {
        switch row.status {
        case "working": return "运行中"
        case "blocked": return "等待确认"
        case "idle": return "空闲"
        case "done": return "完成"
        default: return "未知"
        }
    }
}

// MARK: - Pieces

struct PulseDot: View {
    let color: Color
    var pulsing: Bool = false
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .opacity(pulsing ? (dim ? 0.35 : 1.0) : 1.0)
            .animation(
                pulsing ? .easeInOut(duration: 1.1).repeatForever(autoreverses: true) : .default,
                value: dim
            )
            .onAppear { dim = pulsing }
            .onChange(of: pulsing) { value in dim = value }
    }
}

struct VisualEffectView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}
