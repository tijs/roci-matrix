/**
 * IPC Client for Agent Service
 * Sends messages to roci-agent via Unix socket
 */

import { encodeMessage, readExactly } from './protocol.ts';
import type { AgentResponse, UserMessage, UserReaction } from '../types.ts';

/**
 * Check if an error is retriable (transient connection issues)
 */
function isRetriable(error: unknown): boolean {
  return error instanceof Deno.errors.ConnectionRefused ||
    error instanceof Deno.errors.NotFound;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * IPC client to communicate with roci-agent
 */
export class AgentIPCClient {
  private socketPath: string;
  private timeout: number;
  private maxRetries: number;

  constructor(
    socketPath: string = '/var/run/roci/agent.sock',
    timeout: number = 600_000,
    maxRetries: number = 3,
  ) {
    this.socketPath = socketPath;
    this.timeout = timeout; // 10 minutes default for complex agent work
    this.maxRetries = maxRetries;
  }

  /**
   * Send message to agent and wait for response
   * Retries transient failures with exponential backoff
   */
  async sendMessage(
    message: UserMessage | UserReaction,
  ): Promise<AgentResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.sendMessageOnce(message);
      } catch (error) {
        lastError = error;

        if (!isRetriable(error)) {
          // Non-retriable error, fail immediately
          break;
        }

        if (attempt < this.maxRetries - 1) {
          const delay = 100 * Math.pow(4, attempt); // 100ms, 400ms, 1600ms
          console.log(
            `⚠️  IPC connection failed (attempt ${
              attempt + 1
            }/${this.maxRetries}), retrying in ${delay}ms...`,
          );
          await sleep(delay);
        }
      }
    }

    // All retries failed, return error response
    if (lastError instanceof Deno.errors.NotFound) {
      return {
        type: 'error',
        error: 'Could not connect to agent service after retries. It may not be running.',
        timestamp: new Date().toISOString(),
      };
    }

    if (lastError instanceof Deno.errors.ConnectionRefused) {
      return {
        type: 'error',
        error: 'Agent service connection refused after retries. It may be restarting.',
        timestamp: new Date().toISOString(),
      };
    }

    if (lastError instanceof Error && lastError.message.includes('timeout')) {
      return {
        type: 'error',
        error: 'Agent request timed out after 10 minutes. The agent may be overloaded or crashed.',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      type: 'error',
      error: `IPC error: ${lastError}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Send message once (no retries)
   * @throws Error on connection failure
   */
  private async sendMessageOnce(
    message: UserMessage | UserReaction,
  ): Promise<AgentResponse> {
    // Connect to agent service
    const conn = await Deno.connect({
      transport: 'unix',
      path: this.socketPath,
    });

    try {
      // Encode and send message
      const encoded = encodeMessage(message);
      await conn.write(encoded);

      // Read response with timeout
      const response = await this.readResponseWithTimeout(conn);
      return response as unknown as AgentResponse;
    } finally {
      conn.close();
    }
  }

  /**
   * Read response with timeout
   */
  private async readResponseWithTimeout(
    conn: Deno.Conn,
  ): Promise<Record<string, unknown>> {
    let timeoutHandle: number | undefined;

    try {
      return await new Promise((resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('timeout')),
          this.timeout,
        );
        this.readResponse(conn)
          .then(resolve)
          .catch(reject);
      });
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Read length-prefixed response
   */
  private async readResponse(
    conn: Deno.Conn,
  ): Promise<Record<string, unknown>> {
    // Read 4-byte length prefix
    const lengthBytes = await readExactly(conn, 4);
    const length = new DataView(lengthBytes.buffer).getUint32(0, false); // false = big-endian

    // Read message data
    const messageBytes = await readExactly(conn, length);
    const messageText = new TextDecoder().decode(messageBytes);

    try {
      return JSON.parse(messageText);
    } catch (error) {
      throw new Error(`Failed to parse agent response: ${error}`);
    }
  }
}
