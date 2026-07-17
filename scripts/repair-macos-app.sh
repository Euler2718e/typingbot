#!/bin/zsh

set -eu

readonly expected_bundle_id="app.typingbot.desktop"

usage() {
  echo "usage: $0 /path/to/TypingBot.app [--no-open]" >&2
  exit 64
}

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "error: this repair tool only runs on macOS" >&2
  exit 1
}

[[ $# -ge 1 && $# -le 2 ]] || usage

app_path="$1"
open_app=true

if [[ $# -eq 2 ]]; then
  [[ "$2" == "--no-open" ]] || usage
  open_app=false
fi

[[ -d "$app_path" && ! -L "$app_path" ]] || {
  echo "error: TypingBot.app was not found at: $app_path" >&2
  exit 1
}

info_plist="$app_path/Contents/Info.plist"
executable="$app_path/Contents/MacOS/typingbot"

[[ -f "$info_plist" && -x "$executable" ]] || {
  echo "error: that folder is not a complete TypingBot application" >&2
  exit 1
}

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null || true)"
[[ "$bundle_id" == "$expected_bundle_id" ]] || {
  echo "error: refusing to modify an app with bundle ID '$bundle_id'" >&2
  exit 1
}

if ! codesign --verify --deep --strict "$app_path" >/dev/null 2>&1; then
  echo "Repairing the incomplete signature on this older TypingBot build..."
  codesign --force --deep --options runtime --timestamp=none --sign - "$app_path"
fi

# This removes the downloaded-file marker from TypingBot only. It does not
# weaken Gatekeeper globally or change the Mac's security settings.
xattr -dr com.apple.quarantine "$app_path" 2>/dev/null || true

codesign --verify --deep --strict --verbose=2 "$app_path"

if [[ "$open_app" == true ]]; then
  open "$app_path"
  echo "TypingBot was verified and opened."
else
  echo "TypingBot was repaired and verified."
fi
