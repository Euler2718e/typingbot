# Blockers

## Signed public installers

The application and release workflows can build macOS, Windows, and Linux packages, but fully trusted one-click installation requires platform signing credentials that are not available in this repository.

- macOS distribution needs an Apple Developer ID certificate plus notarization credentials.
- Windows warning-free distribution needs a trusted code-signing certificate.
- These credentials must be stored as GitHub Actions secrets and must never be committed.

Until signing is configured, users may see an operating-system warning and need to use the documented manual-open flow.

## Local DMG wrapper

The optimized macOS binary and `TypingBot.app` bundle build successfully. Tauri's local Finder-based DMG layout script failed in this automation environment after creating the app bundle. The GitHub release workflow repeats DMG creation on GitHub's macOS runners, which are the intended release environment.
