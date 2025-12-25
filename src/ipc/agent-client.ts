/**
 * IPC Client for Agent Service
 * Sends messages to roci-agent via Unix socket
 */

import { encodeMessage, readExactly } from './protocol.ts';
import type { AgentResponse, UserMessage, UserReaction } from '../types.ts';

/**
 * IPC client to communicate with roci-agent
 */
export class AgentIPCClient {
  private socketPath: string;
  private timeout: number;

  constructor(socketPath: string = '/var/run/roci/agent.sock', timeout: number = 600_000) {
    this.socketPath = socketPath;
    this.timeout = timeout; // 10 minutes default for complex agent work
  }

  /**
   * Send message to agent and wait for response
   */
  async sendMessage(message: UserMessage | UserReaction): Promise<AgentResponse> {
    try {
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
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return {
          type: 'error',
          error: 'Could not connect to agent service. It may not be running.',
          timestamp: new Date().toISOString(),
        };
      }

      if (error instanceof Deno.errors.ConnectionRefused) {
        return {
          type: 'error',
          error: 'Agent service connection refused. It may be restarting.',
          timestamp: new Date().toISOString(),
        };
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        return {
          type: 'error',
          error:
            'Agent request timed out after 10 minutes. The agent may be overloaded or crashed.',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        type: 'error',
        error: `IPC error: ${error}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Read response with timeout
   */
  private async readResponseWithTimeout(conn: Deno.Conn): Promise<Record<string, unknown>> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), this.timeout);
    });

    const readPromise = this.readResponse(conn);

    return await Promise.race([readPromise, timeoutPromise]);
  }

  /**
   * Read length-prefixed response
   */
  private async readResponse(conn: Deno.Conn): Promise<Record<string, unknown>> {
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
