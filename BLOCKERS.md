# Blockers

## Signed public executables

The terminal release workflow builds macOS, Windows, and Linux archives without any `.app` or graphical installer. Fully trusted public executables still require platform signing credentials that are not available in this repository.

- macOS distribution needs an Apple Developer ID certificate plus notarization credentials.
- Windows warning-free distribution needs a trusted code-signing certificate.
- These credentials must be stored as GitHub Actions secrets and must never be committed.

Mac terminal binaries receive an ad-hoc signature in the release workflow. `scripts/install-terminal.sh` copies the two executables into the user's `~/.local/bin`, removes quarantine only from those copies, verifies or repairs their local ad-hoc signatures, and launches the OpenTUI application without changing Gatekeeper globally.

This avoids the application-bundle opening failure but cannot turn an unidentified binary into an Apple-trusted public release. Managed Mac policy can still prohibit it. Developer ID signing and notarization remain future hardening work rather than a dependency of the Terminal-first flow.

## Linux Wayland input

The native input and global-shortcut libraries support Linux X11. Wayland intentionally restricts synthetic input and global hotkeys, so full parity is not promised there. Users should run TypingBot in an X11 session until a trustworthy compositor-specific path exists.
