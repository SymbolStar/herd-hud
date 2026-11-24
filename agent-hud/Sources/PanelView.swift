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
        default: return unknown
        }
    }
}

// MARK: - Root panel

struct PanelView: View {
    @ObservedObject var store: AgentStore
    let width: CGFloat
    @State private var showAll = false
    @State private var horizontalAll = false

    private var board: Board? { store.board }

    private var compact: Bool { width < 220 }

    private var rows: [AgentRow] {
        guard let board else { return [] }
        if showAll { return board.rows }
        let cutoff = Date().addingTimeInterval(-3600)
        return board.rows.filter { row in
            if row.isActive { return true }
            if let at = row.lastActiveAt { return at >= cutoff }
            return false
        }
    }

    /// The horizontal bar shows anything active now plus agents active in the
    /// last hour, so it keeps useful context after a turn finishes.
    private var horizontalRows: [AgentRow] {
        guard let board else { return [] }
        if horizontalAll { return board.rows }
        let cutoff = Date().addingTimeInterval(-3600)
        return board.rows.filter { row in
            if row.isActive { return true }
            if let at = row.lastActiveAt { return at >= cutoff }
            return false
        }
    }

    var body: some View {
        Group {
            if store.layoutMode == .vertical {
                verticalBody
                    .frame(width: width)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                horizontalBody
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .background(
            VisualEffectView()
                .overlay(Color.black.opacity(0.18))
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
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
        }
        .padding(.horizontal, compact ? 9 : 12)
        .padding(.vertical, compact ? 8 : 10)
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

    @ViewBuilder
    private var verticalContent: some View {
        if let board {
            if rows.isEmpty {
                emptyState(board)
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { row in
                            AgentRowView(row: row, compact: compact) { store.focus(row) }
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

    private func emptyState(_ board: Board) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 18, weight: .light))
                .foregroundStyle(Color.white.opacity(0.35))
            Text(board.rows.isEmpty ? "没有在运行的 agent" : "最近 1 小时没有活跃 agent")
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
            Text(showAll ? "全部" : "1h")
                .font(.system(size: compact ? 9 : 10, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.55))
        }
        .buttonStyle(.plain)
        .help(showAll ? "只显示最近 1 小时活跃的 agent" : "显示全部 agent")
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
                            Text(board.rows.isEmpty ? "没有在运行的 agent" : "最近 1 小时没有活跃 agent")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.white.opacity(0.45))
                                .padding(.horizontal, 4)
                        } else {
                            ForEach(horizontalRows) { row in
                                AgentChipView(row: row) { store.focus(row) }
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

    private var horizontalFilterButton: some View {
        Button {
            horizontalAll.toggle()
        } label: {
            Text(horizontalAll ? "全部" : "1h")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.5))
        }
        .buttonStyle(.plain)
        .help(horizontalAll ? "只显示最近 1 小时活跃的 agent" : "显示全部 agent")
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
