# Blockers

## Signed public installers

The application and release workflows can build macOS, Windows, and Linux packages, but fully trusted one-click installation requires platform signing credentials that are not available in this repository.

- macOS distribution needs an Apple Developer ID certificate plus notarization credentials.
- Windows warning-free distribution needs a trusted code-signing certificate.
- These credentials must be stored as GitHub Actions secrets and must never be committed.

Mac builds now receive a complete ad-hoc signature and pass `codesign --verify --deep --strict`. `scripts/install-macos.sh` provides the primary per-user installation path for `.app`, `.zip`, and `.dmg` releases: it validates the bundle, removes quarantine only from the installed TypingBot copy, registers it, and opens the menu-bar utility without disabling Gatekeeper globally. `scripts/repair-macos-app.sh` remains a legacy-bundle repair tool.

This removes the current manual **Open Anyway** dependency, but it cannot turn an unidentified build into an Apple-trusted one. Managed Mac policy can still prohibit it, and universal warning-free double-click installation remains blocked on Developer ID signing and notarization credentials.

## Local DMG wrapper

The optimized macOS binary and `TypingBot.app` bundle build successfully. Tauri's local Finder-based DMG layout script failed in this automation environment after creating the app bundle. The GitHub release workflow repeats DMG creation on GitHub's macOS runners, which are the intended release environment.
