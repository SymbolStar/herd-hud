import AppKit
import SwiftUI
import Combine

// MARK: - Panel

final class HUDPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class PanelController {
    let panel: HUDPanel
    private let store: AgentStore
    private let width: CGFloat
    private let heightFraction: Double
    private var layoutCancellable: AnyCancellable?
    /// Programmatic moves (mode switches, screen changes) must not be persisted as
    /// user drags; those stale origins caused the panel to land oddly.
    private var layoutChangedAt = Date.distantPast

    init(store: AgentStore, config: HUDConfig) {
        self.store = store
        self.width = CGFloat(config.panelWidth)
        self.heightFraction = config.panelHeightFraction

        panel = HUDPanel(
            contentRect: NSRect(x: 0, y: 0, width: CGFloat(config.panelWidth), height: 620),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.animationBehavior = .none

        let hosting = NSHostingView(rootView: PanelView(store: store, width: CGFloat(config.panelWidth)))
        hosting.autoresizingMask = [.width, .height]
        hosting.frame = NSRect(x: 0, y: 0, width: CGFloat(config.panelWidth), height: 620)
        panel.contentView = hosting

        applyLayout()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowMoved),
            name: NSWindow.didMoveNotification,
            object: panel
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        layoutCancellable = store.$layoutMode
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.applyLayout() }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private var isVisible: Bool { panel.isVisible }

    func show() {
        applyLayout()
        panel.orderFrontRegardless()
        HUDLog.write("panel shown \(store.layoutMode.rawValue) frame=\(NSStringFromRect(panel.frame))")
    }

    func hide() {
        panel.orderOut(nil)
    }

    func toggle() {
        if isVisible { hide() } else { show() }
    }

    func moveToPointerScreen() {
        UserDefaults.standard.removeObject(forKey: Self.originKey(for: store.layoutMode))
        applyLayout()
    }

    static func screenUnderPointer() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { $0.frame.contains(mouse) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    @objc private func windowMoved() {
        guard Date().timeIntervalSince(layoutChangedAt) > 0.6 else { return }
        UserDefaults.standard.set(
            NSStringFromPoint(panel.frame.origin),
            forKey: Self.originKey(for: store.layoutMode)
        )
    }

    @objc private func screenChanged() {
        applyLayout()
    }

    private func applyLayout() {
        guard let pointerScreen = Self.screenUnderPointer() else { return }
        // Prefer the screen that already holds this layout's saved position so a
        // remembered drag does not get stretched onto a different display.
        let screen = Self.savedOrigin(for: store.layoutMode)
            .flatMap { point in NSScreen.screens.first(where: { $0.visibleFrame.contains(point) }) }
            ?? pointerScreen
        let visibleFrame = screen.visibleFrame
        HUDLog.write(
            "applyLayout \(store.layoutMode.rawValue) screen=\(NSStringFromRect(screen.frame)) " +
            "visible=\(NSStringFromRect(visibleFrame))"
        )
        switch store.layoutMode {
        case .vertical:
            let height = max(320, min(visibleFrame.height * CGFloat(heightFraction), 760))
            panel.setContentSize(NSSize(width: width, height: height))
            applyOrigin(for: .vertical, screen: screen, defaultOrigin: NSPoint(
                x: visibleFrame.maxX - width - 14,
                y: visibleFrame.midY - height / 2
            ))
        case .horizontal:
            let barWidth = max(560, visibleFrame.width - 32)
            let barHeight: CGFloat = 42
            panel.setContentSize(NSSize(width: barWidth, height: barHeight))
            applyOrigin(for: .horizontal, screen: screen, defaultOrigin: NSPoint(
                x: visibleFrame.minX + 16,
                y: visibleFrame.maxY - barHeight - 12
            ))
        }
    }

    /// Place the panel and clamp it fully inside the target screen; a remembered
    /// origin from another display or size must never leave the bar half off-screen.
    private func applyOrigin(for layout: HUDLayout, screen: NSScreen, defaultOrigin: NSPoint) {
        layoutChangedAt = Date()
        let visibleFrame = screen.visibleFrame
        var origin = defaultOrigin
        if let saved = Self.savedOrigin(for: layout), visibleFrame.contains(saved) {
            origin = saved
        }
        let size = panel.frame.size
        let minX = visibleFrame.minX + 8
        let maxX = max(minX, visibleFrame.maxX - size.width - 8)
        let minY = visibleFrame.minY + 8
        let maxY = max(minY, visibleFrame.maxY - size.height - 8)
        origin.x = min(max(origin.x, minX), maxX)
        origin.y = min(max(origin.y, minY), maxY)
        panel.setFrameOrigin(origin)
        HUDLog.write("applyOrigin \(layout.rawValue) = \(NSStringFromPoint(origin))")
    }

    private static func originKey(for layout: HUDLayout) -> String {
        "AgentHUD.origin.v2.\(layout.rawValue)"
    }

    private static func savedOrigin(for layout: HUDLayout) -> NSPoint? {
        guard let raw = UserDefaults.standard.string(forKey: originKey(for: layout)) else { return nil }
        let point = NSPointFromString(raw)
        guard point.x.isFinite, point.y.isFinite else { return nil }
        guard NSScreen.screens.contains(where: { $0.visibleFrame.contains(point) }) else { return nil }
        return point
    }
}

// MARK: - Status item

final class StatusItemController: NSObject, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let store: AgentStore
    private let panel: PanelController
    private var cancellable: AnyCancellable?
    private var layoutItems: [NSMenuItem] = []

    init(store: AgentStore, panel: PanelController) {
        self.store = store
        self.panel = panel
        super.init()

        menu.delegate = self
        menu.addItem(withTitle: "显示 / 隐藏面板", action: #selector(togglePanel), keyEquivalent: "t")

        let verticalItem = NSMenuItem(title: "布局：右侧竖列", action: #selector(useVerticalLayout), keyEquivalent: "")
        verticalItem.target = self
        let horizontalItem = NSMenuItem(title: "布局：顶部横向", action: #selector(useHorizontalLayout), keyEquivalent: "")
        horizontalItem.target = self
        menu.addItem(verticalItem)
        menu.addItem(horizontalItem)
        layoutItems = [verticalItem, horizontalItem]

        menu.addItem(withTitle: "移到鼠标所在屏幕", action: #selector(moveToPointerScreen), keyEquivalent: "")
        menu.addItem(withTitle: "立即刷新", action: #selector(refresh), keyEquivalent: "r")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Agent HUD", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items where item.action != nil {
            item.target = self
        }
        statusItem.menu = menu
        HUDLog.write("status item installed")

        cancellable = store.$board.sink { [weak self] board in
            self?.update(board)
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        layoutItems[0].state = store.layoutMode == .vertical ? .on : .off
        layoutItems[1].state = store.layoutMode == .horizontal ? .on : .off
    }

    private func update(_ board: Board?) {
        let working = board?.counts.working ?? 0
        let blocked = board?.counts.blocked ?? 0
        let title: String
        if working + blocked == 0 {
            title = "◌"
        } else if blocked > 0 {
            title = "◉\(working) ⚠︎\(blocked)"
        } else {
            title = "◉\(working)"
        }
        if let button = statusItem.button {
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
            ]
            button.attributedTitle = NSAttributedString(string: title, attributes: attributes)
            button.toolTip = "Agent HUD · \(working) 运行中 / \(blocked) 等待确认 / \(board?.counts.total ?? 0) 个 agent"
        }
    }

    @objc private func togglePanel() { panel.toggle() }
    @objc private func moveToPointerScreen() { panel.moveToPointerScreen() }
    @objc private func refresh() { store.refreshNow() }
    @objc private func useVerticalLayout() { store.setLayout(.vertical) }
    @objc private func useHorizontalLayout() { store.setLayout(.horizontal) }
    @objc private func quit() { NSApp.terminate(nil) }
}

// MARK: - App delegate

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var store: AgentStore?
    private var panel: PanelController?
    private var status: StatusItemController?
    private var boardCancellable: AnyCancellable?
    private var lastBoardSignature = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        HUDLog.write("Agent HUD launching")
        HUDConfig.writeExampleIfMissing()
        let config = HUDConfig.load()
        let store = AgentStore(config: config)
        let panel = PanelController(store: store, config: config)
        self.store = store
        self.panel = panel
        status = StatusItemController(store: store, panel: panel)
        boardCancellable = store.$board.sink { board in
            guard let board else { return }
            let signature = "\(board.counts.total)/\(board.counts.working)/\(board.counts.blocked)/\(board.counts.remote)"
            guard signature != self.lastBoardSignature else { return }
            self.lastBoardSignature = signature
            HUDLog.write(
                "board total=\(board.counts.total) working=\(board.counts.working) " +
                "blocked=\(board.counts.blocked) remote=\(board.counts.remote)"
            )
        }
        store.start()
        panel.show()
    }

    func applicationWillTerminate(_ notification: Notification) {
        store?.flushActivity()
        HUDLog.write("Agent HUD terminating")
    }
}
