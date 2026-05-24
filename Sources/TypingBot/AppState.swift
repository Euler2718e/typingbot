import Foundation
import Combine

enum AppState: Equatable {
    case idle
    case ready
    case typing
    case paused
}

@MainActor
final class AppStateManager: ObservableObject {
    @Published private(set) var current: AppState = .idle

    func set(_ newState: AppState) {
        guard current != newState else { return }
        current = newState
    }
}
