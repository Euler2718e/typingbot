#!/bin/zsh

set -eu

readonly expected_bundle_id="app.typingbot.desktop"
readonly script_dir="${0:A:h}"
readonly repository_root="${script_dir:h}"
readonly local_build="$repository_root/src-tauri/target/release/bundle/macos/TypingBot.app"

source_path=""
destination="$HOME/Applications/TypingBot.app"
open_after_install=true
work_dir=""
mount_point=""
staging_dir=""
previous_app=""
installed_app=false

usage() {
  cat >&2 <<EOF
usage: $0 [TypingBot.app|TypingBot.zip|TypingBot.dmg] [options]

Options:
  --destination PATH  Install somewhere other than ~/Applications/TypingBot.app
  --no-open           Install and verify without opening TypingBot
  -h, --help          Show this help

With no download path, the script installs the app built in this repository.
You can type the command, add a space, then drag the download into Terminal.
EOF
}

fail() {
  echo "error: $1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$mount_point" ]]; then
    /usr/bin/hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  fi

  if [[ "$installed_app" != true && -n "$previous_app" && -d "$previous_app" ]]; then
    if [[ -e "$destination" ]]; then
      /bin/rm -rf "$destination"
    fi
    /bin/mv "$previous_app" "$destination" || true
  fi

  if [[ -n "$staging_dir" && -d "$staging_dir" ]]; then
    /bin/rm -rf "$staging_dir"
  fi

  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    /bin/rm -rf "$work_dir"
  fi
}

trap cleanup EXIT INT TERM

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer only runs on macOS"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --destination)
      [[ $# -ge 2 ]] || fail "--destination needs a path"
      destination="$2"
      shift 2
      ;;
    --no-open)
      open_after_install=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      fail "unknown option: $1"
      ;;
    *)
      [[ -z "$source_path" ]] || fail "provide only one TypingBot download"
      source_path="$1"
      shift
      ;;
  esac
done

if [[ -z "$source_path" ]]; then
  [[ -d "$local_build" ]] || {
    usage
    fail "no local build was found; pass the downloaded TypingBot file"
  }
  source_path="$local_build"
fi

[[ "$destination" == /* && "$destination" == *.app ]] || \
  fail "the destination must be an absolute path ending in .app"

work_dir="$(/usr/bin/mktemp -d /tmp/typingbot-install.XXXXXX)"

find_typingbot_app() {
  local root="$1"
  local results
  results="$(/usr/bin/find "$root" -type d -name TypingBot.app -prune -print | /usr/bin/head -n 2)"
  [[ -n "$results" ]] || fail "the download does not contain TypingBot.app"
  [[ "${results//$'\n'/}" == "$results" ]] || fail "the download contains more than one TypingBot.app"
  echo "$results"
}

case "$source_path" in
  *.app)
    [[ -d "$source_path" && ! -L "$source_path" ]] || \
      fail "TypingBot.app was not found at: $source_path"
    source_app="$source_path"
    ;;
  *.zip)
    [[ -f "$source_path" ]] || fail "the zip file was not found at: $source_path"
    archive_dir="$work_dir/archive"
    /bin/mkdir -p "$archive_dir"
    echo "Unpacking TypingBot..."
    /usr/bin/ditto -x -k "$source_path" "$archive_dir"
    source_app="$(find_typingbot_app "$archive_dir")"
    ;;
  *.dmg)
    [[ -f "$source_path" ]] || fail "the disk image was not found at: $source_path"
    mount_point="$work_dir/mount"
    /bin/mkdir -p "$mount_point"
    echo "Opening the TypingBot disk image..."
    /usr/bin/hdiutil attach "$source_path" -nobrowse -readonly -mountpoint "$mount_point" -quiet
    source_app="$(find_typingbot_app "$mount_point")"
    ;;
  *)
    fail "use a TypingBot .app, .zip, or .dmg download"
    ;;
esac

verify_identity() {
  local app_path="$1"
  local info_plist="$app_path/Contents/Info.plist"
  local executable="$app_path/Contents/MacOS/typingbot"
  local bundle_id

  [[ -f "$info_plist" && -x "$executable" ]] || \
    fail "the download is not a complete TypingBot application"

  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null || true)"
  [[ "$bundle_id" == "$expected_bundle_id" ]] || \
    fail "refusing an app with bundle ID '$bundle_id'"
}

verify_bundle() {
  local app_path="$1"
  verify_identity "$app_path"
  /usr/bin/codesign --verify --deep --strict "$app_path" >/dev/null 2>&1 || \
    fail "the app signature is damaged; download a fresh TypingBot release"
}

echo "Verifying the TypingBot bundle..."
verify_bundle "$source_app"

destination_parent="${destination:h}"
/bin/mkdir -p "$destination_parent"
staging_dir="$(/usr/bin/mktemp -d "$destination_parent/.typingbot-install.XXXXXX")"
staged_app="$staging_dir/TypingBot.app"

echo "Installing TypingBot in $destination..."
/usr/bin/ditto "$source_app" "$staged_app"

# Remove the downloaded-file marker only from this staged copy. This does not
# disable Gatekeeper or alter any system-wide security setting.
/usr/bin/xattr -dr com.apple.quarantine "$staged_app" 2>/dev/null || true
verify_bundle "$staged_app"

if [[ -e "$destination" ]]; then
  [[ -d "$destination" && ! -L "$destination" ]] || \
    fail "refusing to replace a non-application item at: $destination"
  verify_identity "$destination"
  /usr/bin/osascript -e 'tell application id "app.typingbot.desktop" to quit' >/dev/null 2>&1 || true
  previous_app="$staging_dir/TypingBot.previous.app"
  /bin/mv "$destination" "$previous_app"
fi

/bin/mv "$staged_app" "$destination"
/usr/bin/xattr -dr com.apple.quarantine "$destination" 2>/dev/null || true
verify_bundle "$destination"

launch_services="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$launch_services" ]]; then
  "$launch_services" -f "$destination" >/dev/null 2>&1 || true
fi

installed_app=true

if [[ "$open_after_install" == true ]]; then
  /usr/bin/open "$destination"
  echo "TypingBot is installed and running in the menu bar."
else
  echo "TypingBot is installed and verified."
fi

echo "macOS may still ask for Accessibility permission before TypingBot can type."
