# ADR-0053: Standard protected installation-archive envelope

## Status

Accepted local implementation under the beta-completion mandate, 26 October 2026,
after corrected independent DESIGN/CODE review and the complete local baseline.
No device, operational transport delivery or native activation approval.
Canonical byte/API/ownership contract: BETA_COMPLETION_SPECIFICATION.md §S6e.

## Decision

Use actual standard Web Crypto AES-256-GCM with a fresh random32-byte key,12-byte
nonce and128-bit tag per seal. A separate random recovery code carries that key;
the protected ASCII file envelope never includes it. No human password/KDF,
application cipher, plugin fork, escrow, network service or production fallback.
Import only nonextractable AES keys, verify genuine public CryptoKey metadata before
the next crypto step, and bind fixed version/algorithm/encoding/inner-format AAD.

Encrypt exact already validated V3 canonical ASCII, whose existing formatter escapes
every original raw UTF16 code unit. Reopening requires authenticated decryption,
exact plaintext length, ASCII validation and actual V3 format/digest verification.
Standard cryptography binds bytes under a key, not source authenticity, Profile
ownership, entitlement, fresh server admission or permission to mount/publish.

## Alternatives and consequences

Plaintext portable archives do not meet the confidentiality boundary. A password
would add strength/KDF and recovery policy; a hosted relay would add a server and
external data boundary. A fresh random code uses existing platform cryptography
without either dependency. The user must keep code and file separate in later
explicit delivery. Losing a code has no escrow fallback; this primitive does not
delete or alter the original source, so a later source helper may prepare a new
archive while that source remains available.

API strings and native/JS memory cannot be securely erased. Owned temporary byte
arrays are overwritten only after observed native work settles, without claiming
secure-memory erasure. Actual WKWebView support, file/bridge memory and physical
delivery require device acceptance; missing platform crypto refuses. No custom
scheme/private API, signing, app identity or storage configuration changes follow.

Only private protection functions and their exact guards are added. Source-helper
isolation/writer exclusion, target atomic staging/readback, fresh auth/denial-aware
handoff and release/backup gates remain separate. No portable identity grants,
credential copying or app/root caller is introduced.

## Reference

[Web Cryptography API, W3C Recommendation26 January2017](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#aes-gcm).
