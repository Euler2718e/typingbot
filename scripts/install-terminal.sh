#!/bin/zsh

set -eu

readonly script_dir="${0:A:h}"
readonly source_tui="$script_dir/typingbot"
readonly source_engine="$script_dir/typingbot-engine"
readonly install_dir="${TYPINGBOT_INSTALL_DIR:-$HOME/.local/bin}"
readonly installed_tui="$install_dir/typingbot"
readonly installed_engine="$install_dir/typingbot-engine"

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "error: this installer is for macOS release archives" >&2
  exit 1
}

[[ -f "$source_tui" && -f "$source_engine" ]] || {
  echo "error: keep install-terminal.sh beside typingbot and typingbot-engine" >&2
  exit 1
}

/bin/mkdir -p "$install_dir"
staging_dir="$(/usr/bin/mktemp -d "$install_dir/.typingbot-install.XXXXXX")"
trap '/bin/rm -rf "$staging_dir"' EXIT INT TERM

/usr/bin/ditto "$source_tui" "$staging_dir/typingbot"
/usr/bin/ditto "$source_engine" "$staging_dir/typingbot-engine"
/bin/chmod 755 "$staging_dir/typingbot" "$staging_dir/typingbot-engine"

# Remove quarantine only from the two TypingBot executables copied from the
# authenticated private release. This does not disable Gatekeeper globally.
/usr/bin/xattr -d com.apple.quarantine "$staging_dir/typingbot" 2>/dev/null || true
/usr/bin/xattr -d com.apple.quarantine "$staging_dir/typingbot-engine" 2>/dev/null || true

if ! /usr/bin/codesign --verify --strict "$staging_dir/typingbot" >/dev/null 2>&1; then
  /usr/bin/codesign --force --timestamp=none --sign - "$staging_dir/typingbot"
fi
if ! /usr/bin/codesign --verify --strict "$staging_dir/typingbot-engine" >/dev/null 2>&1; then
  /usr/bin/codesign --force --timestamp=none --sign - "$staging_dir/typingbot-engine"
fi

/bin/mv -f "$staging_dir/typingbot" "$installed_tui"
/bin/mv -f "$staging_dir/typingbot-engine" "$installed_engine"

profile="${TYPINGBOT_PROFILE_PATH:-$HOME/.zprofile}"
path_line='export PATH="$HOME/.local/bin:$PATH"'
if [[ ! -f "$profile" ]] || ! /usr/bin/grep -Fq "$path_line" "$profile"; then
  /usr/bin/printf '\n# TypingBot terminal command\n%s\n' "$path_line" >> "$profile"
fi

echo "TypingBot was installed at $installed_tui"
echo "Run it now with: $installed_tui"
echo "Future Terminal windows can use: typingbot"

if [[ "${1:-}" != "--no-open" ]]; then
  exec "$installed_tui"
fi
