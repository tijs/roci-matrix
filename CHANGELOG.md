# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.4] - 2026-01-14

### Fixed

- **Make typing indicators fire-and-forget** - Typing indicator calls now run
  asynchronously without blocking message processing
  - Previously, if Matrix homeserver was slow/unresponsive, the entire message
    flow would block waiting for the typing indicator (up to 66+ seconds)
  - Now uses `void` and `setTimeout` to send typing indicators without awaiting
  - Applies to text, image, and file handlers
  - Root cause: `ESOCKETTIMEDOUT` errors would block until the 60s timeout

## [1.3.3] - 2026-01-14

### Changed

- **Add timestamps to all log output** - All logger functions now include ISO
  timestamps for easier debugging of timing issues
  - Format: `2026-01-14T10:30:45.123Z ℹ️  Message`
  - Helps track time spent in each processing step

## [1.3.2] - 2026-01-14

### Fixed

- **Fix type compatibility with Element's SDK fork** - Update code to match
  Element's matrix-bot-sdk API changes
  - Cast `getEvent()` response to raw object for consistent property access
  - Use Sqlite store type (0) instead of Sled (removed in newer SDK versions)
  - Add lint ignore for const enum workaround with isolatedModules

## [1.3.1] - 2026-01-14

### Fixed

- **Fix image/file uploads broken by authenticated media** - Switch from
  `matrix-bot-sdk` to Element's fork `@vector-im/matrix-bot-sdk@0.7.1-element.15`
  which supports Matrix 1.11 authenticated media endpoints
  - Old SDK used deprecated `/_matrix/media/v3/download/` endpoints
  - New SDK uses authenticated `/_matrix/client/v1/media/download/` endpoints
  - Fixes M_FORBIDDEN errors when downloading encrypted media

## [1.3.0] - 2026-01-13

### Added

- **Matrix reply context support** - When user replies to a specific message,
  include the original message context so the agent understands what's being
  referenced
  - New `ReplyContext` interface with event_id, sender, content, timestamp
  - `getReplyContext()` function fetches original message via `client.getEvent()`
  - `stripReplyFallback()` removes quoted text from reply body
  - `reply_to` field added to `UserMessage` IPC type
  - Extended `MatrixMessageEvent` type with `m.in_reply_to` support
  - Unit tests for fallback stripping

## [1.2.6] - 2026-01-12

### Changed

- **Increase room info cache TTL to 24 hours** - Since we typically always use
  the same room, the 5-minute TTL was unnecessarily short
  - Stale cache fallback on errors means long TTL is safe
  - Reduces API calls even further

## [1.2.5] - 2026-01-12

### Fixed

- **Cache room info to avoid repeated API calls** - Room info (member count,
  encryption status) is now cached for 5 minutes
  - Previously called getJoinedRoomMembers on EVERY incoming message
  - Now uses cache, falling back to stale cache on errors
  - Added retry logic (3 attempts with exponential backoff)
  - Significantly reduces API calls and timeout exposure

## [1.2.4] - 2026-01-12

### Fixed

- **Increase sync HTTP timeout** - Patch Matrix SDK to use 90s timeout for sync
  requests instead of the hardcoded 40s
  - SDK defaults to 40s HTTP timeout for 30s long-poll (only 10s buffer)
  - Now uses 90s timeout (30s long-poll + 60s buffer for slow responses)
  - Should eliminate most ESOCKETTIMEDOUT errors during sync operations

## [1.2.3] - 2026-01-12

### Fixed

- **Retry logic for Matrix message sends** - Add exponential backoff retry for
  message sends to handle intermittent homeserver timeouts
  - Added `withRetry()` helper with 3 attempts and exponential backoff (1s, 2s, 4s)
  - Applied to `sendTextMessage()`, `sendReaction()`, and `sendImage()`
  - Retries on ESOCKETTIMEDOUT, ETIMEDOUT, ECONNRESET, ECONNREFUSED errors
  - Fixes intermittent "ESOCKETTIMEDOUT" errors when hamster.farm is slow

## [1.2.1] - 2026-01-05

### Fixed

- **Image visibility with text+image messages** - Fix bug where images weren't
  visible when sent with accompanying text
  - Root cause: Element sends text+image as two separate events (m.text then
    m.image)
  - Text was processed first, agent responded "no image", then image arrived
  - Added `MessageAggregator` class to buffer text messages and combine with
    following images/files within 2-second window
  - Images and files now receive the user's text as context instead of just the
    filename

## [1.2.0] - 2026-01-04

### Added

- **Image upload capability** - Send generated images to Matrix rooms
  - New `uploadMedia()` function with E2E encryption support
  - New `sendImage()` function for sending m.image events
  - `getImageDimensions()` helper for PNG/JPEG dimension parsing
  - New `agent_image` IPC message type for receiving images from roci-agent
  - Handles encrypted and unencrypted rooms automatically

## [1.1.2] - 2026-01-03

### Changed

- **Secrets Documentation** - Updated documentation to reflect secrets
  management
  - Removed `MATRIX_ACCESS_TOKEN` from `.env.example` (now in secrets.conf)
  - Updated CLAUDE.md with clear separation of secrets vs config
  - Follows project-wide secrets management pattern

## [1.1.1] - 2026-01-02

### Fixed

- **Runtime Directory**: Fix shared runtime directory to prevent socket deletion
  on service restart
- **Error Handling**: Improved error handling and documentation

## [1.1.0] - 2025-12-29

### Added

- **Persistent Attachments Storage** - Files and images now stored permanently
  with metadata
  - Organized by upload date in `state/attachments/by-date/YYYY-MM-DD/`
  - JSONL metadata log (`metadata.jsonl`) for searchable file index
  - Metadata includes: timestamp, event ID, filename, MIME type, size, path,
    indexed status
  - Auto-generated README.md with query examples using jq
  - Enables RAG indexing of files from previous sessions
  - Replaces temporary storage in `/var/lib/roci/tmp-images`

## [1.0.1] - 2025-12-27

### Fixed

- **Media Handling**: Fixed base64 encoding and added MIME type validation
  - Properly encodes media to base64 for transmission
  - Validates MIME types before processing

- **Code Quality**: Fixed lint error with unused client parameter

### Documentation

- Added quality checks section to CLAUDE.md
- Added versioned deployment documentation to README

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
- Manual device verification via Element (one-time setup)
- Systemd service configuration
- Comprehensive README and CLAUDE.md documentation
- Added node_modules/ to .gitignore

### Changed

- **Migration from Python (matrix-nio) to TypeScript (matrix-bot-sdk)**
- Runtime: Python → Deno with npm: imports
- Authentication: Password login per session → persistent access token
- Encryption storage: Olm → Rust SDK Sled database
- New device (old messages won't decrypt from Python version)
- Simplified device verification to manual-only (matrix-bot-sdk doesn't expose
  SAS APIs)

### Fixed

- Removed 10,530 node_modules files from git tracking

### Technical Details

- Deno 2.0+ runtime
- matrix-bot-sdk@^0.7.1 via npm: imports
- 4-byte big-endian length-prefixed IPC protocol
- TypeScript strict mode
- 500-line maximum per file
- Dependency injection for testability

## Migration Notes

This is a complete rewrite from Python to TypeScript. The Python implementation
(`roci-matrix-bot`) should be archived. Key differences:

1. **New device login required** - old encryption keys not migrated
2. **Manual verification needed** - one-time setup via Element
3. **Persistent access token** - no re-login on each start
4. **Same IPC protocol** - byte-compatible with roci-agent

Deployment: Archive Python version, deploy Deno version, perform manual device
verification.
