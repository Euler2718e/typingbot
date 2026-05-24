#!/bin/bash
set -euo pipefail

APP_NAME="TypingBot"
APP_DIR="dist/${APP_NAME}.app"
BIN_PATH=".build/release/${APP_NAME}"

echo "Building ${APP_NAME}..."
swift build -c release

echo "Creating ${APP_DIR}..."
rm -rf "dist/${APP_NAME}" "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources"

cp "${BIN_PATH}" "${APP_DIR}/Contents/MacOS/${APP_NAME}"
cp "Info.plist" "${APP_DIR}/Contents/Info.plist"
cp "assets/icon.png" "${APP_DIR}/Contents/Resources/icon.png"

chmod +x "${APP_DIR}/Contents/MacOS/${APP_NAME}"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "${APP_DIR}" >/dev/null
fi

echo "Done: ${APP_DIR}"
