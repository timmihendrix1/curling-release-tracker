#!/bin/sh
set -eu
# Injected Security API only: this executable never opens the actual Keychain.
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
task_scratch=$(mktemp -d "${TMPDIR:-/tmp}/curling-keychain-tests.XXXXXX")
trap 'rm -rf "$task_scratch"' EXIT HUP INT TERM
xcrun swiftc \
  "$task_root/ios/App/App/CredentialKeychainReader.swift" \
  "$task_root/tests/native/CredentialKeychainReaderTests.swift" \
  -module-cache-path "$task_scratch/module-cache" \
  -o "$task_scratch/reader-tests"
"$task_scratch/reader-tests"
