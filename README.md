# roci-matrix

Matrix communication service for Roci - handles E2E encrypted messaging and IPC communication with the roci-agent service.

## Architecture

This is the Matrix protocol layer in Roci's three-service architecture:

- **roci-memory** (Deno) - Memory management (Letta + state files + message cache)
- **roci-agent** (Node.js) - Agent harness following Claude Agent SDK pattern
- **roci-matrix** (Deno) - Matrix protocol with E2E encryption ← **This repo**

### IPC Communication

**Bidirectional IPC:**

- **Client:** Sends user messages to `/var/run/roci/agent.sock`
- **Server:** Receives proactive messages on `/var/run/roci/matrix.sock`

**Protocol:** Unix domain socket with 4-byte big-endian length prefix + JSON

## Features

- ✅ End-to-end encryption (matrix-bot-sdk with Rust crypto)
- ✅ Text message handling
- ✅ Image handling (encrypted/unencrypted, download, decrypt, base64)
- ✅ File attachments (PDF, TXT, MD, DOCX, 50MB limit)
- ✅ Reactions
- ✅ Proactive messages from watch rotation
- ✅ Authorization (single authorized user, DM-only)
- ✅ TypeScript with strict mode
- ✅ Deno runtime

## Quick Start

### Prerequisites

- Deno 2.0+
- Matrix homeserver account
- roci-agent and roci-memory services running (for IPC)

### Installation

```bash
# Clone repository
git clone https://github.com/tijs/roci-matrix
cd roci-matrix

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### One-Time Login

Get your access token and device ID:

```bash
deno task login
# Follow prompts, copy access_token and device_id to .env
```

### Manual Device Verification

1. Login to Element with the same account
2. Settings → Sessions
3. Find "Roci Bot (Deno)"
4. Click "Verify" and complete emoji verification

This is a one-time process. Device verification persists across restarts.

### Run

```bash
# Development (auto-reload)
deno task dev

# Production
deno task start
```

### Testing

```bash
# Type check
deno task check

# Lint
deno task lint

# Format
deno task fmt

# Run tests
deno task test
```

## Deployment

This service uses semantic versioning with git tags for releases.

### Quick Deploy (Latest)

```bash
# From parent roci/ directory
./scripts/deploy.sh matrix
./scripts/restart.sh matrix
```

### Versioned Deploy

```bash
# On VPS, checkout specific version
ssh roci 'cd ~/roci/roci-matrix && git fetch --tags && git checkout v1.0.0'

# Restart service
./scripts/restart.sh matrix
```

### Release Process

1. Update `CHANGELOG.md` with changes
2. Update version in `deno.json`
3. Commit changes
4. Create git tag: `git tag v1.x.x`
5. Push: `git push && git push --tags`
6. Create GitHub release

See parent repository [roci](https://github.com/tijs/roci) for full deployment scripts and systemd service configuration.

## Development

### Project Structure

```
roci-matrix/
├── src/
│   ├── main.ts              # Entry point
│   ├── config.ts            # Environment configuration
│   ├── types.ts             # TypeScript interfaces
│   ├── matrix/
│   │   ├── client.ts        # Matrix client setup
│   │   ├── crypto.ts        # E2E encryption
│   │   └── media.ts         # Media download/decrypt
│   ├── handlers/
│   │   ├── message.ts       # Text messages
│   │   ├── image.ts         # Images
│   │   ├── file.ts          # File attachments
│   │   └── reaction.ts      # Reactions
│   ├── ipc/
│   │   ├── agent-client.ts  # IPC client
│   │   ├── matrix-server.ts # IPC server
│   │   └── protocol.ts      # Message types
│   └── utils/
│       ├── logger.ts        # Logging
│       └── auth.ts          # Authorization
├── tests/
├── store/                   # E2E crypto keys (gitignored)
├── deno.json
└── .env                     # Environment variables (gitignored)
```

### Code Style

- 500-line maximum per file
- Strict TypeScript
- Use `debugPrint()` for logging (removed in production builds)
- Dependency injection for testability
- No side effects in pure functions

## Configuration

All configuration via environment variables (`.env` file):

- `MATRIX_HOMESERVER` - Matrix homeserver URL
- `MATRIX_USER_ID` - Bot's Matrix user ID
- `MATRIX_ACCESS_TOKEN` - Access token from login
- `MATRIX_DEVICE_ID` - Device ID from login
- `AUTHORIZED_USER` - Your Matrix user ID (only you can use the bot)
- `IPC_SOCKET_PATH` - Path to agent service socket (default: `/var/run/roci/agent.sock`)
- `IPC_SERVER_PATH` - Path for Matrix IPC server (default: `/var/run/roci/matrix.sock`)
- `STORE_DIR` - Crypto storage directory (default: `./store`)
- `SENTRY_DSN` - Optional error tracking

## Architecture Details

### Message Flow

1. User sends encrypted message via Matrix
2. Matrix service decrypts and validates authorization
3. Forwards to roci-agent via IPC
4. Agent processes with Claude API
5. Response flows back through IPC
6. Matrix service encrypts and sends to user

### Proactive Messages (Watch Rotation)

1. systemd timer triggers agent every 2 hours
2. Agent generates proactive insight
3. Agent sends to Matrix via `/var/run/roci/matrix.sock`
4. Matrix IPC server receives and sends to user

## License

MIT

## Related

- [roci](https://github.com/tijs/roci) - Parent repository
- [roci-agent](https://github.com/tijs/roci-agent) - Agent service
- [roci-memory](https://github.com/tijs/roci-memory) - Memory service
- [matrix-bot-sdk](https://github.com/turt2live/matrix-bot-sdk) - Matrix SDK
