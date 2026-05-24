import CoreGraphics
import Foundation

// EventTapManager owns a single CGEventTap that:
//   1. Identifies and passes through synthetic events from TypingEngine.
//   2. Detects hotkeys (Cmd+Opt+T, Cmd+Opt+O, Esc) and calls callbacks.
//   3. In .suppressing mode: returns nil for all physical key events (blocks them).
//   4. In .monitoring mode: passes all events through.
//
// Thread safety: all public methods are called from AppDelegate (@MainActor = main thread).
// The CGEventTap C callback also runs on the main thread because the run loop source
// is added to CFRunLoopGetMain(). The global variable _tapManager is only written
// on the main thread and read from the same thread via the run loop callback.

private var _tapManager: EventTapManager?

private let kVK_T:   CGKeyCode = 0x11   // kVK_ANSI_T
private let kVK_O:   CGKeyCode = 0x1F   // kVK_ANSI_O
private let kVK_Esc: CGKeyCode = 0x35   // kVK_Escape

final class EventTapManager {

    enum Mode { case monitoring, suppressing }

    var onToggle:      (() -> Void)?
    var onOpenPopover: (() -> Void)?
    var onEsc:         (() -> Void)?

    private(set) var mode: Mode = .monitoring
    private var tapPort:       CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    /// True when the CGEventTap was created successfully — the definitive
    /// indicator that both Accessibility and Input Monitoring are granted.
    var isRunning: Bool { tapPort != nil }

    // ── Lifecycle ───────────────────────────────────────────────────────────────

    @discardableResult
    func start(mode: Mode) -> Bool {
        stop()
        self.mode = mode
        _tapManager = self

        // kCGAnnotatedSessionEventTap: events at the window-server annotation
        // pass — modifiers are fully resolved here, which is required for reliable
        // Cmd+Opt+T detection. kCGHeadInsertEventTap puts our tap first in the
        // list. kCGEventTapOptionDefault means active (can suppress by returning nil).
        let mask: CGEventMask =
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.keyUp.rawValue)

        guard let port = CGEvent.tapCreate(
            tap:              .cgAnnotatedSessionEventTap,
            place:            .headInsertEventTap,
            options:          .defaultTap,
            eventsOfInterest: mask,
            callback:         tapCCallback,
            userInfo:         nil
        ) else {
            print("[EventTapManager] CGEventTapCreate failed — permissions missing?")
            _tapManager = nil
            return false
        }

        tapPort = port
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        runLoopSource = src
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        return true
    }

    func stop() {
        if let port = tapPort { CGEvent.tapEnable(tap: port, enable: false) }
        if let src = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), src, .commonModes)
        }
        tapPort = nil
        runLoopSource = nil
        _tapManager = nil
    }

    func setMode(_ newMode: Mode) {
        guard newMode != mode else { return }
        start(mode: newMode)
    }

    // ── Event handling (called from C callback, on main thread) ─────────────────

    func handleEvent(type: CGEventType, event: CGEvent) -> CGEvent? {
        // Pass synthetic events from TypingEngine through unconditionally.
        if event.getIntegerValueField(.eventSourceUserData) == syntheticEventCookie {
            return event
        }

        // macOS auto-disables slow taps — re-enable immediately.
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let port = tapPort { CGEvent.tapEnable(tap: port, enable: true) }
            return event
        }

        guard type == .keyDown || type == .keyUp else {
            return mode == .suppressing ? nil : event
        }

        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        let flags   = event.flags
        let cmd     = flags.contains(.maskCommand)
        let opt     = flags.contains(.maskAlternate)

        if type == .keyDown {
            if cmd && opt && keyCode == kVK_T {
                DispatchQueue.main.async { _tapManager?.onToggle?() }
                return nil   // suppress the keystroke itself
            }
            if cmd && opt && keyCode == kVK_O {
                DispatchQueue.main.async { _tapManager?.onOpenPopover?() }
                return nil
            }
            if keyCode == kVK_Esc {
                DispatchQueue.main.async { _tapManager?.onEsc?() }
                return mode == .suppressing ? nil : event
            }
        }

        return mode == .suppressing ? nil : event
    }
}

// C-compatible callback. CGEventTapCallBack is a Swift closure type (block-bridged),
// but declaring it as a top-level function avoids any capture-related compiler warnings.
private func tapCCallback(
    proxy:    CGEventTapProxy,
    type:     CGEventType,
    event:    CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let manager = _tapManager else { return Unmanaged.passRetained(event) }
    if let result = manager.handleEvent(type: type, event: event) {
        return Unmanaged.passRetained(result)
    }
    return nil   // nil = suppress
}
