import Foundation
import CoreGraphics

// Tag embedded in every synthetic CGEvent's kCGEventSourceUserData field.
// Defined at top level (no actor isolation) so EventTapManager can read it
// from its C callback without crossing an actor boundary.
let syntheticEventCookie: Int64 = 0x54424F54  // "TBOT"

// TypingEngine manages the async Task that types text and posts CGEvents.
// All public methods are @MainActor; the Task also runs on the main actor
// (inherited from the call site), so Task.sleep suspends it without blocking
// the thread — the run loop stays responsive during inter-character delays.

@MainActor
final class TypingEngine {

    var onDone: (() -> Void)?

    private var typingTask: Task<Void, Never>?
    private var pauseContinuation: CheckedContinuation<Void, Never>?
    private var isPaused = false

    // kCGEventSourceStatePrivate: the source tracks key-state independently
    // of physical hardware — safe for synthetic keystroke injection.
    private let eventSource = CGEventSource(stateID: .privateState)

    // ── Public API ─────────────────────────────────────────────────────────────

    func start(text: String, from position: Int, settings: Settings) {
        stop()
        isPaused = false
        let chars = Array(text)
        typingTask = Task {
            await runLoop(chars: chars, startPos: position, settings: settings)
        }
    }

    func pause() {
        isPaused = true
    }

    func resume() {
        guard isPaused else { return }
        isPaused = false
        pauseContinuation?.resume()
        pauseContinuation = nil
    }

    func stop() {
        typingTask?.cancel()
        typingTask = nil
        pauseContinuation?.resume()   // unpark any suspended continuation
        pauseContinuation = nil
        isPaused = false
    }

    // ── Typing loop ────────────────────────────────────────────────────────────

    private func runLoop(chars: [Character], startPos: Int, settings: Settings) async {
        let sim   = HumanSim(settings: settings)
        var burst = HumanSim.BurstState()
        var pos   = startPos

        do {
            while pos < chars.count {
                if isPaused {
                    await withCheckedContinuation { cont in
                        pauseContinuation = cont
                    }
                    try Task.checkCancellation()
                }

                let extra = try await sim.typeNext(
                    text: chars,
                    pos: pos,
                    burstState: &burst,
                    typeChar: { [weak self] char in
                        try Task.checkCancellation()
                        self?.postChar(char)
                    },
                    backspace: { [weak self] in
                        try Task.checkCancellation()
                        self?.postKey(keyCode: 0x33)   // kVK_Delete
                    }
                )
                pos += 1 + extra
            }
            onDone?()
        } catch {
            // CancellationError or other — exit silently; caller manages state.
        }
    }

    // ── CGEvent posting ────────────────────────────────────────────────────────

    private func postChar(_ char: Character) {
        guard let src = eventSource else { return }

        if char == "\n" {
            postKey(keyCode: 0x24, source: src)   // kVK_Return
            return
        }

        // Use keyboardSetUnicodeString with keyCode=0 — layout-independent.
        // Receiving apps (NSTextField, Electron, browsers) read the Unicode
        // payload, not the raw keycode, so this works across all layouts.
        guard let scalar = char.unicodeScalars.first else { return }
        let uniChar = [UniChar(scalar.value)]

        if let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: uniChar)
            down.setIntegerValueField(.eventSourceUserData, value: syntheticEventCookie)
            down.post(tap: .cgSessionEventTap)
        }
        if let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: 1, unicodeString: uniChar)
            up.setIntegerValueField(.eventSourceUserData, value: syntheticEventCookie)
            up.post(tap: .cgSessionEventTap)
        }
    }

    private func postKey(keyCode: CGKeyCode, source: CGEventSource? = nil) {
        let src = source ?? eventSource
        guard let src else { return }
        if let down = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true) {
            down.setIntegerValueField(.eventSourceUserData, value: syntheticEventCookie)
            down.post(tap: .cgSessionEventTap)
        }
        if let up = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false) {
            up.setIntegerValueField(.eventSourceUserData, value: syntheticEventCookie)
            up.post(tap: .cgSessionEventTap)
        }
    }
}
