import AppKit
import SwiftUI
import Combine

@MainActor
final class StatusBarController: NSObject, NSPopoverDelegate {

    let popoverModel: PopoverModel

    private let stateManager: AppStateManager
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var cancellables = Set<AnyCancellable>()

    init(stateManager: AppStateManager, popoverModel: PopoverModel) {
        self.stateManager  = stateManager
        self.popoverModel  = popoverModel
        super.init()
        buildStatusItem()
        buildPopover()
        observeState()
    }

    // ── Status item ────────────────────────────────────────────────────────────

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let btn = statusItem.button else { return }
        btn.action = #selector(iconClicked)
        btn.target = self
        applyIcon(.idle)
    }

    private func applyIcon(_ state: AppState) {
        guard let btn = statusItem.button else { return }

        let (symbol, nsColor, tip): (String, NSColor, String) = {
            switch state {
            case .idle:
                return ("circle",      NSColor(white: 0.45, alpha: 1),
                        "TypingBot — Idle")
            case .ready:
                return ("circle.fill", NSColor(white: 0.72, alpha: 1),
                        "TypingBot — Ready (Cmd+Opt+T to start)")
            case .typing:
                return ("play.fill",   NSColor(white: 0.82, alpha: 1),
                        "TypingBot — Typing…")
            case .paused:
                return ("pause.fill",  NSColor(white: 0.62, alpha: 1),
                        "TypingBot — Paused")
            }
        }()

        if let img = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) {
            let cfg     = NSImage.SymbolConfiguration(pointSize: 13, weight: .medium)
            let sized   = img.withSymbolConfiguration(cfg) ?? img
            btn.image   = tinted(sized, color: nsColor)
        }
        btn.toolTip = tip
    }

    private func tinted(_ image: NSImage, color: NSColor) -> NSImage {
        let copy = image.copy() as! NSImage
        copy.lockFocus()
        color.set()
        NSRect(origin: .zero, size: image.size).fill(using: .sourceAtop)
        copy.unlockFocus()
        return copy
    }

    private func observeState() {
        stateManager.$current
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.applyIcon(state) }
            .store(in: &cancellables)
    }

    // ── Popover ────────────────────────────────────────────────────────────────

    private func buildPopover() {
        popover          = NSPopover()
        popover.behavior = .transient
        popover.delegate = self

        let vc = NSHostingController(
            rootView: PopoverView(
                model:     popoverModel,
                onDismiss: { [weak self] in self?.popover.close() }
            )
        )
        popover.contentViewController = vc
        popover.contentSize           = vc.view.fittingSize
    }

    func showPopover() {
        guard let btn = statusItem.button else { return }
        if popover.isShown { return }
        // .accessory apps need explicit activation to accept keyboard input.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: btn.bounds, of: btn, preferredEdge: .minY)
    }

    func hidePopover() {
        popover.close()
    }

    var isPopoverShown: Bool { popover.isShown }

    // ── NSPopoverDelegate ──────────────────────────────────────────────────────

    func popoverDidClose(_ notification: Notification) { }

    @objc private func iconClicked() {
        if popover.isShown {
            popover.close()
        } else {
            showPopover()
        }
    }
}
