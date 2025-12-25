# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-25

### Added

- Initial TypeScript/Deno implementation of Matrix service
- E2E encryption using matrix-bot-sdk with Rust crypto (WASM)
- Text message handling with authorization
- Image handling (encrypted/unencrypted, download, decrypt, base64)
- File attachment support (PDF, TXT, MD, DOCX, 50MB limit)
- Reaction handling
- Bidirectional IPC communication with roci-agent
- IPC client to `/var/run/roci/agent.sock`
- IPC server on `/var/run/roci/matrix.sock` for proactive messages
- Manual device verification via Element
- Systemd service configuration
- Comprehensive README and CLAUDE.md documentation

### Changed

- **Migration from Python (matrix-nio) to TypeScript (matrix-bot-sdk)**
- Runtime: Python → Deno with npm: imports
- Authentication: Password login per session → persistent access token
- Encryption storage: Olm → Rust SDK Sled database
- New device (old messages won't decrypt from Python version)

### Technical Details

- Deno 2.0+ runtime
- matrix-bot-sdk@^0.7.1 via npm: imports
- 4-byte big-endian length-prefixed IPC protocol
- TypeScript strict mode
- 500-line maximum per file
- Dependency injection for testability

## Migration Notes

This is a complete rewrite from Python to TypeScript. The Python implementation (`roci-matrix-bot`) should be archived. Key differences:

1. **New device login required** - old encryption keys not migrated
2. **Manual verification needed** - one-time setup via Element
3. **Persistent access token** - no re-login on each start
4. **Same IPC protocol** - byte-compatible with roci-agent

Deployment: Archive Python version, deploy Deno version, perform manual device verification.
