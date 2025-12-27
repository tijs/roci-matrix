# CLAUDE.md - roci-matrix

Matrix communication service for Roci.

## Service Overview

This service handles Matrix protocol (E2E encrypted messaging) and communicates
with the roci-agent service via Unix socket IPC.

**Role in Architecture:**

- Receives encrypted messages from authorized user (`@tijs:envs.net`)
- Forwards to roci-agent service via `/var/run/roci/agent.sock`
- Sends AI responses back to Matrix
- Receives proactive messages from roci-agent via `/var/run/roci/matrix.sock`

## Development Commands

### Setup

```bash
# Install dependencies (automatic with Deno)
deno task check

# Create .env from template
cp .env.example .env
# Edit .env with actual credentials
```

### Quality Checks (Required Before Deployment)

All changes must pass quality checks before deployment:

```bash
# Format code (auto-fix)
deno fmt

# Lint check
deno lint

# Type check
deno check src/**/*.ts tests/**/*.ts

# Run tests
deno test --allow-all
```

**These checks are enforced in the deployment workflow** - `./scripts/deploy.sh`
runs them automatically.

### Running

```bash
# Development with auto-reload
deno task dev

# Production
deno task start

# One-time login to get access token
deno task login
```

### Testing

```bash
# Type check
deno task check

# Run tests
deno task test

# Lint
deno task lint

# Format
deno task fmt
```

### Deployment to VPS

Use parent directory deploy scripts:

```bash
# From parent roci/ directory
./scripts/deploy.sh matrix        # Deploy only
./scripts/restart.sh matrix       # Restart only
./scripts/deploy-restart.sh       # Both (all services)
./scripts/status.sh               # Check status
./scripts/logs.sh matrix          # View logs
```

## Architecture

### Three-Service Architecture

Roci uses three independent systemd services:

1. **roci-memory.service** (Deno) - Memory management
2. **roci-agent.service** (Node.js) - Agent harness, depends on memory
3. **roci-matrix.service** (Deno) - Matrix protocol, depends on agent

### Bidirectional IPC

This service has both an IPC **client** and **server**:

| Direction      | Socket                      | Purpose                    |
| -------------- | --------------------------- | -------------------------- |
| Matrix → Agent | `/var/run/roci/agent.sock`  | Forward user messages      |
| Agent → Matrix | `/var/run/roci/matrix.sock` | Receive proactive messages |

**Protocol:** Unix domain socket, JSON with 4-byte big-endian length prefix

### Authentication Flow

- Bot uses **access token** from password login (persists across restarts)
- One-time manual device verification via Element client
- Access token and device ID stored in `.env`

### E2E Encryption

- Uses `matrix-bot-sdk` with `RustSdkCryptoStorageProvider` (Rust SDK via WASM)
- Encryption keys stored in `store/` directory (must be writable)
- Crypto storage uses Sled database (file-based)
- Old messages from before bot joined cannot be decrypted (expected behavior)

### Message Handling

- Bot only responds to DMs (2-member rooms) from `AUTHORIZED_USER`
- Event handlers: text, images, files, reactions
- Authorization filter: rejects self-messages, unauthorized users, non-DM rooms

### Agent Integration via IPC

**Architecture:**

- Matrix service (this repo) communicates with roci-agent service via Unix
  socket
- Agent service follows Claude Agent SDK pattern (model-agnostic)
- Memory managed by roci-memory service (Letta blocks + state files)
- Model: Claude (primary), GPT/Gemini (future)
- Built-in tools: `Read`, `Write`, `Bash`, `Grep`, `Glob`, etc.

**IPC Communication:**

The Matrix service uses a length-prefixed JSON protocol (4-byte big-endian
length + JSON payload):

```typescript
// Matrix → Agent (user message)
{
  type: 'user_message',
  message_id: 'event_id',
  user_id: '@tijs:envs.net',
  room_id: '!room:envs.net',
  content: 'Message text',
  timestamp: '2025-12-25T16:00:00Z'
}

// Agent → Matrix (response)
{
  type: 'agent_response',
  message_id: 'event_id',
  content: 'AI response text',
  actions: [],
  timestamp: '2025-12-25T16:00:05Z'
}

// Agent → Matrix (proactive message from watch rotation)
{
  type: 'proactive_message',
  user_id: '@tijs:envs.net',
  room_id: '!room:envs.net',
  content: 'Proactive insight...',
  trigger: 'watch_rotation',
  timestamp: '2025-12-25T16:30:00Z'
}
```

**How It Works:**

1. Matrix service receives encrypted message from user
2. Matrix service forwards to roci-agent via Unix socket
3. Agent service executes tool loop with Claude API
4. Agent fetches memory context from roci-memory service
5. Response flows back through IPC to Matrix service
6. Matrix service sends encrypted response to user

**Proactive Messages (Watch Rotation):**

1. systemd timer triggers every 2 hours
2. roci-agent runs watch rotation with time-aware prompt
3. If meaningful insight found, agent sends to Matrix via
   `/var/run/roci/matrix.sock`
4. Matrix IPC server receives and sends to user

## File Structure

```
roci-matrix/
├── src/
│   ├── main.ts              # Entry point, starts services
│   ├── config.ts            # Environment configuration
│   ├── types.ts             # TypeScript type definitions
│   ├── matrix/
│   │   ├── client.ts        # Matrix client setup
│   │   ├── crypto.ts        # E2E encryption handling
│   │   └── media.ts         # Media download/decrypt
│   ├── handlers/
│   │   ├── message.ts       # Text message handler
│   │   ├── image.ts         # Image handler
│   │   ├── file.ts          # File attachment handler
│   │   └── reaction.ts      # Reaction handler
│   ├── ipc/
│   │   ├── agent-client.ts  # IPC client to agent.sock
│   │   ├── matrix-server.ts # IPC server on matrix.sock
│   │   └── protocol.ts      # Message type definitions
│   └── utils/
│       ├── logger.ts        # Logging utilities
│       └── auth.ts          # Authorization checks
├── tests/
│   ├── unit/                # Unit tests
│   └── integration/         # Integration tests
├── deno.json                # Deno configuration
├── .env                     # Environment variables (gitignored)
├── .env.example             # Environment template
├── README.md
├── CLAUDE.md                # This file
├── CHANGELOG.md
└── store/                   # E2E crypto storage (gitignored)
```

## Code Conventions

- **500-line maximum** per file - break up larger modules
- **Strict TypeScript** - all types must be explicit
- **Dependency injection** - for testability
- **Use debugPrint()** for logging (removed in production)
- **No side effects** in pure functions
- **Test with fakes/mocks** - no external dependencies in tests

## Environment Variables

```bash
# Required
MATRIX_HOMESERVER=https://matrix.envs.net
MATRIX_USER_ID=@roci:envs.net
MATRIX_ACCESS_TOKEN=syt_...  # From login.ts
MATRIX_DEVICE_ID=...         # From login.ts
AUTHORIZED_USER=@tijs:envs.net

# IPC
IPC_SOCKET_PATH=/var/run/roci/agent.sock
IPC_SERVER_PATH=/var/run/roci/matrix.sock

# Storage
STORE_DIR=./store

# Optional
SENTRY_DSN=
```

## Systemd Service

See `roci-matrix.service` for deployment configuration.

**Service dependencies:**

- Requires: `roci-agent.service` (which requires `roci-memory.service`)

**Restart policy:**

- Auto-restart on failure (10-second delay)
- Auto-start on server reboot

**Resource limits:**

- Memory: 512MB
- CPU: 50%

## Known Issues

### matrix-bot-sdk with Deno

- matrix-bot-sdk is designed for Node.js but can work via `npm:` imports
- Rust crypto bindings (WASM) should work but are untested in Deno
- If crypto fails, fallback to Node.js runtime

### Encryption

- "No session found" errors for old messages are normal (expected behavior)
- Device verification is manual (one-time via Element)
- Crypto storage must persist across restarts (`store/` directory)

### Media Handling

- matrix-bot-sdk may not expose media decryption API
- Manual AES-CTR decryption implemented as fallback
- File size limit: 50MB
- Supported types: PDF, TXT, MD, DOCX (for RAG)

## Development Status

**Current:** v1.0.0 - TypeScript/Deno migration complete **Migration:** From
Python (matrix-nio) to TypeScript (matrix-bot-sdk) **Runtime:** Deno 2.0+ with
npm: imports

**Production status:** Ready for deployment

**Future enhancements:**

- Auto device verification (research matrix-bot-sdk API)
- Media type expansion
- Performance optimizations

## Related Services

- **roci-agent**: Consumes Matrix messages, executes agent loop
- **roci-memory**: Provides memory context to agent
