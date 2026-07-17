# Blockers

## Signed public installers

The application and release workflows can build macOS, Windows, and Linux packages, but fully trusted one-click installation requires platform signing credentials that are not available in this repository.

- macOS distribution needs an Apple Developer ID certificate plus notarization credentials.
- Windows warning-free distribution needs a trusted code-signing certificate.
- These credentials must be stored as GitHub Actions secrets and must never be committed.

Mac builds now receive a complete ad-hoc signature and pass `codesign --verify --deep --strict`. Users may still see Gatekeeper's unidentified-developer warning and need the documented **Open Anyway** flow. `scripts/repair-macos-app.sh` repairs older app bundles without disabling Gatekeeper globally.

## Local DMG wrapper

The optimized macOS binary and `TypingBot.app` bundle build successfully. Tauri's local Finder-based DMG layout script failed in this automation environment after creating the app bundle. The GitHub release workflow repeats DMG creation on GitHub's macOS runners, which are the intended release environment.
