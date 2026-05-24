import AppKit
import Combine

// AppDelegate is the orchestrator — mirrors main.py's App class.
// @MainActor guarantees all state mutations and hotkey handlers run on the
// main thread, matching the Python design where Qt signals serialised everything.

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private let store        = SettingsStore()
    private let stateManager = AppStateManager()
    private let typingEngine = TypingEngine()
    private let tapManager   = EventTapManager()
    private let popoverModel = PopoverModel()

    private var statusBar: StatusBarController!
    private var wizard: PermissionWizard?
    private var showedTapFailureWizard = false

    private var settings: Settings = .defaults
    private var armedText: String  = ""
    private var position: Int      = 0
    private var escPaused: Bool    = false

    private var cancellables = Set<AnyCancellable>()

    // ── App lifecycle ──────────────────────────────────────────────────────────

    func applicationDidFinishLaunching(_ note: Notification) {
        settings = store.load()
        armedText = settings.lastText

        // Sync popover model with persisted settings
        popoverModel.text           = settings.lastText
        popoverModel.wpm            = Double(settings.wpm)
        popoverModel.typos          = settings.typos
        popoverModel.transpositions = settings.transpositions
        popoverModel.variableSpeed  = settings.variableSpeed
        popoverModel.burstMode      = settings.burstMode

        popoverModel.onArm = { [weak self] text, wpm, typos, trans, varSpeed, burst in
            self?.handleArmed(text: text, wpm: wpm, typos: typos,
                              transpositions: trans, variableSpeed: varSpeed, burstMode: burst)
        }

        statusBar = StatusBarController(stateManager: stateManager,
                                        popoverModel: popoverModel)

        typingEngine.onDone = { [weak self] in self?.handleTypingDone() }

        // State → tap mode
        stateManager.$current
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.syncTapMode(state) }
            .store(in: &cancellables)

        if allPermissionsGranted() {
            // Clear any leftover relaunch flag from a previous wizard run.
            UserDefaults.standard.removeObject(forKey: "typingbot.didRelaunch")
            startTap()
        } else {
            showWizard()
        }
    }

    func applicationWillTerminate(_ note: Notification) {
        typingEngine.stop()
        tapManager.stop()
    }

    // ── Permission wizard ──────────────────────────────────────────────────────

    private func showWizard() {
        let w = PermissionWizard()
        w.onComplete = { [weak self] granted in
            if granted { self?.startTap() }
        }
        w.show()
        wizard = w
    }

    // ── Event tap wiring ───────────────────────────────────────────────────────

    private func startTap() {
        tapManager.onToggle      = { [weak self] in self?.handleToggle() }
        tapManager.onOpenPopover = { [weak self] in self?.handleOpenPopover() }
        tapManager.onEsc         = { [weak self] in self?.handleEsc() }
        if !tapManager.start(mode: .monitoring), !showedTapFailureWizard {
            showedTapFailureWizard = true
            showWizard()
        }
    }

    // ── Hotkey handlers ────────────────────────────────────────────────────────

    private func handleToggle() {
        switch stateManager.current {
        case .ready:   startTyping()
        case .typing:
            escPaused = false
            pauseTyping()
        case .paused:
            escPaused = false
            resumeTyping()
        case .idle:    break
        }
    }

    private func handleOpenPopover() {
        if stateManager.current == .typing {
            escPaused = false
            pauseTyping()
        }
        statusBar.showPopover()
    }

    private func handleEsc() {
        switch stateManager.current {
        case .typing:
            escPaused = true
            pauseTyping()
        case .paused where escPaused:
            hardStop()
        case .idle, .ready, .paused:
            break
        }
    }

    // ── Arm ────────────────────────────────────────────────────────────────────

    private func handleArmed(text: String, wpm: Int,
                              typos: Bool, transpositions: Bool,
                              variableSpeed: Bool, burstMode: Bool) {
        typingEngine.stop()
        armedText              = text
        position               = 0
        escPaused              = false
        settings.wpm           = wpm
        settings.lastText      = text
        settings.typos         = typos
        settings.transpositions = transpositions
        settings.variableSpeed = variableSpeed
        settings.burstMode     = burstMode
        store.save(settings)
        stateManager.set(text.trimmingCharacters(in: .whitespaces).isEmpty ? .idle : .ready)
    }

    // ── Typing control ─────────────────────────────────────────────────────────

    private func startTyping() {
        escPaused = false
        typingEngine.start(text: armedText, from: position, settings: settings)
        stateManager.set(.typing)
    }

    private func pauseTyping() {
        typingEngine.pause()
        stateManager.set(.paused)
    }

    private func resumeTyping() {
        escPaused = false
        typingEngine.resume()
        stateManager.set(.typing)
    }

    private func hardStop() {
        typingEngine.stop()
        position = 0
        escPaused = false
        stateManager.set(armedText.trimmingCharacters(in: .whitespaces).isEmpty ? .idle : .ready)
    }

    private func handleTypingDone() {
        position = 0
        escPaused = false
        stateManager.set(.idle)
    }

    // ── State → tap mode ───────────────────────────────────────────────────────

    private func syncTapMode(_ state: AppState) {
        switch state {
        case .typing:                tapManager.setMode(.suppressing)
        case .idle, .ready, .paused: tapManager.setMode(.monitoring)
        }
    }
}
