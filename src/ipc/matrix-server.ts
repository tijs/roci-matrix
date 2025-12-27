/**
 * IPC Server for Matrix Service
 * Receives proactive messages from roci-agent
 */

import { decodeMessage, encodeMessage } from './protocol.ts';
import type { ProactiveMessage, ProactiveResponse } from '../types.ts';

/**
 * Handler for proactive messages
 */
export type ProactiveMessageHandler = (
  message: ProactiveMessage,
) => Promise<ProactiveResponse>;

/**
 * IPC server for receiving proactive messages from agent
 */
export class MatrixIPCServer {
  private socketPath: string;
  private messageHandler: ProactiveMessageHandler;
  private listener: Deno.Listener | null = null;
  private connections: Deno.Conn[] = [];
  private running = false;

  constructor(socketPath: string, messageHandler: ProactiveMessageHandler) {
    this.socketPath = socketPath;
    this.messageHandler = messageHandler;
  }

  /**
   * Start the IPC server
   */
  async start(): Promise<void> {
    // Remove existing socket file if it exists
    try {
      await Deno.remove(this.socketPath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Create Unix socket listener
    this.listener = Deno.listen({ path: this.socketPath, transport: 'unix' });
    this.running = true;

    debugPrint(`✅ IPC server listening on ${this.socketPath}`);

    // Set socket permissions (660 - user and group can read/write)
    try {
      await Deno.chmod(this.socketPath, 0o660);
    } catch (error) {
      debugPrint(`⚠️  Failed to set socket permissions: ${error}`);
    }

    // Handle shutdown signals
    const shutdown = () => this.stop();
    Deno.addSignalListener('SIGTERM', shutdown);
    Deno.addSignalListener('SIGINT', shutdown);

    // Accept connections in the background
    this.acceptConnections();
  }

  /**
   * Accept and handle incoming connections
   */
  private async acceptConnections(): Promise<void> {
    if (!this.listener) return;

    try {
      for await (const conn of this.listener) {
        debugPrint('📡 IPC client connected');
        this.connections.push(conn);
        this.handleConnection(conn);
      }
    } catch (error) {
      if (this.running) {
        debugPrint(`❌ IPC server error: ${error}`);
      }
    }
  }

  /**
   * Handle a single connection
   */
  private async handleConnection(conn: Deno.Conn): Promise<void> {
    let buffer = new Uint8Array(0);

    try {
      // Read data chunks
      for await (const chunk of conn.readable) {
        // Append new data to buffer
        const newBuffer = new Uint8Array(buffer.length + chunk.length);
        newBuffer.set(buffer);
        newBuffer.set(chunk, buffer.length);
        buffer = newBuffer;

        // Try to read messages
        while (buffer.length >= 4) {
          const result = decodeMessage(buffer);

          if (!result) {
            // Not enough data yet
            break;
          }

          const { message, remaining } = result;
          buffer = new Uint8Array(remaining);

          try {
            debugPrint(`📨 IPC received: ${message.type}`);

            // Handle message
            const response = await this.handleMessage(message);

            // Send response
            const writer = conn.writable.getWriter();
            await writer.write(encodeMessage(response));
            writer.releaseLock();
          } catch (error) {
            debugPrint(`❌ Error processing message: ${error}`);
            await this.sendError(conn, (error as Error).message);
          }
        }
      }
    } catch (error) {
      debugPrint(`❌ Connection error: ${error}`);
    } finally {
      debugPrint('📡 IPC client disconnected');
      try {
        conn.close();
      } catch {
        // Ignore close errors
      }
      // Remove from connections list
      const index = this.connections.indexOf(conn);
      if (index > -1) {
        this.connections.splice(index, 1);
      }
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    message: Record<string, unknown>,
  ): Promise<ProactiveResponse> {
    if (message.type === 'proactive_message') {
      return await this.messageHandler(message as unknown as ProactiveMessage);
    }

    return {
      type: 'error',
      error: `Unknown message type: ${message.type}`,
    };
  }

  /**
   * Send error response
   */
  private async sendError(
    conn: Deno.Conn,
    errorMessage: string,
  ): Promise<void> {
    const response: ProactiveResponse = {
      type: 'error',
      error: errorMessage,
    };

    try {
      const writer = conn.writable.getWriter();
      await writer.write(encodeMessage(response));
      writer.releaseLock();
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    debugPrint('🛑 Stopping IPC server...');
    this.running = false;

    // Close all connections
    for (const conn of this.connections) {
      try {
        conn.close();
      } catch {
        // Ignore close errors
      }
    }
    this.connections = [];

    // Close listener
    if (this.listener) {
      try {
        this.listener.close();
      } catch {
        // Ignore close errors
      }
      this.listener = null;
    }

    // Remove socket file
    try {
      Deno.removeSync(this.socketPath);
    } catch {
      // Ignore errors
    }

    Deno.exit(0);
  }
}

/**
 * Debug print helper (removed in production builds)
 */
function debugPrint(message: string): void {
  console.log(message);
}
