import SwiftUI
import AppKit

// ── Model ──────────────────────────────────────────────────────────────────────

@MainActor
final class PopoverModel: ObservableObject {
    @Published var text:           String = ""
    @Published var wpm:            Double = 60   // stored as Double for Slider binding
    @Published var typos:          Bool   = true
    @Published var transpositions: Bool   = true
    @Published var variableSpeed:  Bool   = true
    @Published var burstMode:      Bool   = true

    var onArm: ((String, Int, Bool, Bool, Bool, Bool) -> Void)?
}

// ── Native text editor ─────────────────────────────────────────────────────────
// NSViewRepresentable wrapping NSTextView ensures Cmd+V / Cmd+C / Cmd+A all
// work correctly inside an NSPopover, regardless of app activation policy.

private class FocusingTextView: NSTextView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }
}

struct NativeTextEditor: NSViewRepresentable {
    @Binding var text: String

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    func makeNSView(context: Context) -> NSScrollView {
        let tv = FocusingTextView()
        tv.isEditable          = true
        tv.isSelectable        = true
        tv.allowsUndo          = true
        tv.isRichText          = false
        tv.importsGraphics     = false
        tv.font                = .monospacedSystemFont(ofSize: 12, weight: .regular)
        tv.textColor           = NSColor(white: 0.90, alpha: 1)
        tv.backgroundColor     = NSColor(white: 0.11, alpha: 1)
        tv.drawsBackground     = true
        tv.textContainerInset  = NSSize(width: 7, height: 8)
        tv.delegate            = context.coordinator
        // Disable smart substitutions that mangle pasted text
        tv.isAutomaticQuoteSubstitutionEnabled  = false
        tv.isAutomaticDashSubstitutionEnabled   = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isAutomaticLinkDetectionEnabled      = false
        tv.isAutomaticTextCompletionEnabled     = false

        let scroll = NSScrollView()
        scroll.documentView        = tv
        scroll.hasVerticalScroller = true
        scroll.drawsBackground     = false
        scroll.scrollerStyle       = .overlay
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let tv = scroll.documentView as? NSTextView else { return }
        if tv.string != text {
            // Preserve cursor position when updating from outside
            let sel = tv.selectedRange()
            tv.string = text
            let safeLoc = min(sel.location, (text as NSString).length)
            tv.setSelectedRange(NSRange(location: safeLoc, length: 0))
        }
    }

    class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String
        init(text: Binding<String>) { _text = text }
        func textDidChange(_ note: Notification) {
            guard let tv = note.object as? NSTextView else { return }
            text = tv.string
        }
    }
}

// ── Main popover view ──────────────────────────────────────────────────────────
// Palette: pure grayscale — background #111, surfaces #1a1a1a, text #ebebeb,
// secondary #666, borders #2a2a2a.  Zero hue, zero saturation.

struct PopoverView: View {
    @ObservedObject var model: PopoverModel
    var onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {

            // ── Text area ──────────────────────────────────────────────────────
            ZStack(alignment: .topLeading) {
                NativeTextEditor(text: $model.text)
                    .frame(height: 108)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5)
                            .stroke(Color(white: 0.17), lineWidth: 1)
                    )

                if model.text.isEmpty {
                    Text("Paste or type text here…")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(Color(white: 0.32))
                        .padding(.top, 10)
                        .padding(.leading, 10)
                        .allowsHitTesting(false)
                }
            }

            // ── Speed slider ───────────────────────────────────────────────────
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Speed")
                        .font(.system(size: 11))
                        .foregroundColor(Color(white: 0.45))
                    Spacer()
                    Text("\(Int(model.wpm)) wpm")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Color(white: 0.78))
                        .frame(minWidth: 54, alignment: .trailing)
                }
                Slider(value: $model.wpm, in: 20...250, step: 1)
                    .tint(Color(white: 0.80))
            }

            // ── Toggles ────────────────────────────────────────────────────────
            VStack(spacing: 0) {
                Divider().background(Color(white: 0.18))
                    .padding(.bottom, 8)

                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 7) {
                        ToggleRow(label: "Typos",          isOn: $model.typos)
                        ToggleRow(label: "Transpositions", isOn: $model.transpositions)
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        ToggleRow(label: "Variable speed", isOn: $model.variableSpeed)
                        ToggleRow(label: "Burst mode",     isOn: $model.burstMode)
                    }
                }
            }

            // ── Arm button ─────────────────────────────────────────────────────
            Button(action: arm) {
                Text("Arm")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(white: 0.06))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(Color(white: 0.88))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            .buttonStyle(.plain)
            .padding(.top, 2)

            // ── Bottom bar ─────────────────────────────────────────────────────
            HStack {
                Text("⌘⌥T  start / pause  ·  ⌘⌥O  open  ·  Esc  pause")
                    .font(.system(size: 9))
                    .foregroundColor(Color(white: 0.30))
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
                    .buttonStyle(.plain)
                    .font(.system(size: 9))
                    .foregroundColor(Color(white: 0.30))
            }
        }
        .padding(14)
        .frame(width: 340)
        .background(Color(white: 0.08))
    }

    private func arm() {
        model.onArm?(
            model.text,
            Int(model.wpm),
            model.typos,
            model.transpositions,
            model.variableSpeed,
            model.burstMode
        )
        onDismiss()
    }
}

// ── Toggle row ─────────────────────────────────────────────────────────────────

private struct ToggleRow: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(Color(white: 0.62))
        }
        .toggleStyle(.switch)
        .tint(Color(white: 0.72))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
