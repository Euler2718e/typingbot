// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TypingBot",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TypingBot",
            path: "Sources/TypingBot",
            swiftSettings: [
                // Use Swift 5 language mode — avoids strict concurrency
                // errors from CGEventTap's C callback bridge.
                .unsafeFlags(["-swift-version", "5"])
            ]
        )
    ]
)
