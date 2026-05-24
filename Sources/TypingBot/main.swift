import AppKit

let app = NSApplication.shared

// .accessory = no Dock icon, no menu bar takeover — pure background app.
// Must be set before app.run().
app.setActivationPolicy(.accessory)

// Main thread is guaranteed here (Swift programs start on the main thread).
// assumeIsolated lets us create the @MainActor AppDelegate synchronously.
let delegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate

app.run()
