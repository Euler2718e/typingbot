import AppKit
import ApplicationServices
import CoreGraphics

// ── Permission checks ──────────────────────────────────────────────────────────

func isAccessibilityGranted() -> Bool {
    let options = ["AXTrustedCheckOptionPrompt": false] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

@discardableResult
func requestAccessibilityAccess() -> Bool {
    let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

// CGPreflightListenEventAccess() is CoreGraphics's own public API for checking
// Input Monitoring status (macOS 10.15+). It queries the TCC database directly —
// no tap creation, no IOHIDCheckAccess, no C-pointer closures.
// Updates in real-time when the user toggles the permission in System Settings.
func isInputMonitoringGranted() -> Bool {
    return CGPreflightListenEventAccess()
}

@discardableResult
func requestInputMonitoringAccess() -> Bool {
    return CGRequestListenEventAccess()
}

func allPermissionsGranted() -> Bool {
    isAccessibilityGranted() && isInputMonitoringGranted()
}

// ── Permission wizard ──────────────────────────────────────────────────────────

@MainActor
final class PermissionWizard: NSObject, NSWindowDelegate {

    var onComplete: ((Bool) -> Void)?

    private var window: NSWindow!
    private var bodyLabel: NSTextField!
    private var statusLabel: NSTextField!
    private var openButton: NSButton!
    private var continueButton: NSButton!
    private var pollTimer: Timer?
    private var checkFn: (() -> Bool)?
    private var requestFn: (() -> Bool)?
    private var nextFn:  (() -> Void)?
    private var settingsURL: URL?

    private static let clrBase  = NSColor(white: 0.12, alpha: 1)
    private static let clrText  = NSColor(white: 0.86, alpha: 1)
    private static let clrMuted = NSColor(white: 0.56, alpha: 1)
    private static let clrGreen = NSColor(white: 0.78, alpha: 1)
    private static let clrRed   = NSColor(white: 0.72, alpha: 1)

    // ── Public entry point ─────────────────────────────────────────────────────

    func show() {
        buildWindow()
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.step1()
        }
    }

    // ── Window ─────────────────────────────────────────────────────────────────

    private func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 460, height: 300)
        window = NSWindow(
            contentRect: rect,
            styleMask:   [.titled, .closable],
            backing:     .buffered,
            defer:       false
        )
        window.title                = "TypingBot — Permission Setup"
        window.backgroundColor      = PermissionWizard.clrBase
        window.delegate             = self
        window.isReleasedWhenClosed = false
        window.center()

        let cv = window.contentView!

        let title = label("TypingBot permissions",
                          font: .boldSystemFont(ofSize: 15),
                          color: PermissionWizard.clrText)
        title.frame = NSRect(x: 28, y: 245, width: 404, height: 28)
        cv.addSubview(title)

        bodyLabel = label("", font: .systemFont(ofSize: 13),
                          color: PermissionWizard.clrText)
        bodyLabel.frame = NSRect(x: 28, y: 100, width: 404, height: 140)
        bodyLabel.maximumNumberOfLines = 0
        bodyLabel.lineBreakMode = .byWordWrapping
        cv.addSubview(bodyLabel)

        statusLabel = label("", font: .boldSystemFont(ofSize: 12),
                            color: PermissionWizard.clrGreen)
        statusLabel.frame = NSRect(x: 28, y: 72, width: 404, height: 22)
        cv.addSubview(statusLabel)

        openButton = NSButton(frame: NSRect(x: 194, y: 20, width: 116, height: 34))
        openButton.title      = "Request Access"
        openButton.bezelStyle = .rounded
        openButton.target     = self
        openButton.action     = #selector(requestAccess)
        cv.addSubview(openButton)

        continueButton = NSButton(frame: NSRect(x: 318, y: 20, width: 114, height: 34))
        continueButton.title      = "Check Again"
        continueButton.bezelStyle = .rounded
        continueButton.target     = self
        continueButton.action     = #selector(continueIfReady)
        cv.addSubview(continueButton)

        let quit = NSButton(frame: NSRect(x: 28, y: 20, width: 80, height: 34))
        quit.title            = "Quit"
        quit.bezelStyle       = .rounded
        quit.contentTintColor = PermissionWizard.clrRed
        quit.target           = self
        quit.action           = #selector(quitApp)
        cv.addSubview(quit)
    }

    private func label(_ text: String, font: NSFont, color: NSColor) -> NSTextField {
        let tf = NSTextField(labelWithString: text)
        tf.font            = font
        tf.textColor       = color
        tf.backgroundColor = .clear
        tf.drawsBackground = false
        tf.isBezeled       = false
        tf.isEditable      = false
        tf.isSelectable    = false
        return tf
    }

    // ── Wizard flow ────────────────────────────────────────────────────────────

    private func step1() {
        if !isAccessibilityGranted() {
            startStep(
                body:  "Step 1 of 2 — Accessibility\n\n"
                     + "Required to inject keystrokes into other apps.\n\n"
                     + "Click Request Access, approve the macOS prompt, then click Check Again.",
                url:   "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
                check: isAccessibilityGranted,
                request: requestAccessibilityAccess,
                next:  { [weak self] in self?.step2() }
            )
        } else {
            step2()
        }
    }

    private func step2() {
        if !isInputMonitoringGranted() {
            startStep(
                body:  "Step 2 of 2 — Input Monitoring\n\n"
                     + "Required so hotkeys fire from any app.\n\n"
                     + "Click Request Access, approve the macOS prompt, then click Check Again.",
                url:   "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
                check: isInputMonitoringGranted,
                request: requestInputMonitoringAccess,
                next:  { [weak self] in self?.finish() }
            )
        } else {
            finish()
        }
    }

    private func startStep(body: String, url: String,
                           check: @escaping () -> Bool,
                           request: @escaping () -> Bool,
                           next:  @escaping () -> Void) {
        pollTimer?.invalidate()
        bodyLabel.stringValue   = body
        statusLabel.stringValue = ""
        checkFn = check
        requestFn = request
        nextFn  = next
        settingsURL = URL(string: url)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.requestAccess()
        }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func poll() {
        guard let check = checkFn, check() else { return }
        pollTimer?.invalidate()
        statusLabel.textColor = PermissionWizard.clrGreen
        statusLabel.stringValue = "✓  Permission granted!"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            self?.nextFn?()
        }
    }

    private func finish() {
        pollTimer?.invalidate()
        bodyLabel.stringValue   = "All permissions granted.\n\nTypingBot is ready in the menu bar."
        statusLabel.stringValue = ""
        openButton.isEnabled = false
        continueButton.isEnabled = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self else { return }
            self.window.delegate = nil
            self.window.close()
            NSApp.setActivationPolicy(.accessory)
            self.onComplete?(true)
        }
    }

    // ── NSWindowDelegate ───────────────────────────────────────────────────────

    func windowWillClose(_ notification: Notification) {
        pollTimer?.invalidate()
        NSApp.setActivationPolicy(.accessory)
        // Pass the actual permission state — if the user already had both
        // permissions when they closed the window, startTap() can proceed.
        onComplete?(allPermissionsGranted())
    }

    @objc private func requestAccess() {
        statusLabel.textColor = PermissionWizard.clrMuted
        statusLabel.stringValue = "Waiting for macOS approval..."

        if requestFn?() == true {
            poll()
            return
        }

        if let settingsURL, checkFn?() != true {
            NSWorkspace.shared.open(settingsURL)
        }
    }

    @objc private func continueIfReady() {
        guard let check = checkFn, check() else {
            statusLabel.textColor = PermissionWizard.clrMuted
            statusLabel.stringValue = "Still waiting for this permission."
            return
        }
        poll()
    }

    @objc private func quitApp() { NSApp.terminate(nil) }
}
