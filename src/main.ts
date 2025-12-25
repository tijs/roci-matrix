/**
 * Main entry point for roci-matrix service
 */

import { loadConfig } from './config.ts';
import { createMatrixClient, sendTextMessage, startClient } from './matrix/client.ts';
import { setupEncryptionListeners, verifyEncryption } from './matrix/crypto.ts';
import { setupAutoVerification } from './matrix/verification.ts';
import { AgentIPCClient } from './ipc/agent-client.ts';
import { MatrixIPCServer } from './ipc/matrix-server.ts';
import { handleTextMessage } from './handlers/message.ts';
import { handleImageMessage } from './handlers/image.ts';
import { handleFileMessage } from './handlers/file.ts';
import { handleReaction } from './handlers/reaction.ts';
import type { Config, MatrixMessageEvent, ProactiveMessage, ProactiveResponse } from './types.ts';
import * as logger from './utils/logger.ts';
import type { MatrixClient } from 'matrix-bot-sdk';

/**
 * Main function
 */
async function main() {
  try {
    logger.info('🚀 Starting roci-matrix service...');

    // Load configuration
    const config = await loadConfig();
    logger.success('Configuration loaded');

    // Create Matrix client
    const client = createMatrixClient(config);

    // Set up encryption listeners
    setupEncryptionListeners(client);

    // Set up auto-verification for own devices
    setupAutoVerification(client, config);

    // Verify encryption is available
    verifyEncryption(client);

    // Create IPC client (for sending to agent)
    const agentClient = new AgentIPCClient(config.ipcSocketPath);
    logger.success(`IPC client configured: ${config.ipcSocketPath}`);

    // Set up Matrix event listeners
    setupEventListeners(client, config, agentClient);

    // Start IPC server (for receiving proactive messages from agent)
    const ipcServer = new MatrixIPCServer(
      config.ipcServerPath,
      async (message: ProactiveMessage): Promise<ProactiveResponse> => {
        return await handleProactiveMessage(client, message);
      },
    );

    await ipcServer.start();
    logger.success(`IPC server listening: ${config.ipcServerPath}`);

    // Start Matrix client
    await startClient(client);

    logger.success('🎉 roci-matrix service is running');
  } catch (error) {
    logger.error('Failed to start service', error);
    Deno.exit(1);
  }
}

/**
 * Set up Matrix event listeners
 */
function setupEventListeners(
  client: MatrixClient,
  config: Config,
  agentClient: AgentIPCClient,
): void {
  // Room message events (text, images, files)
  client.on('room.message', async (roomId: string, event: MatrixMessageEvent) => {
    try {
      const msgtype = event.content.msgtype;

      if (msgtype === 'm.text') {
        await handleTextMessage(client, roomId, event, config, agentClient);
      } else if (msgtype === 'm.image') {
        await handleImageMessage(client, roomId, event, config, agentClient);
      } else if (msgtype === 'm.file') {
        await handleFileMessage(client, roomId, event, config, agentClient);
      } else {
        logger.debug(`Ignoring message type: ${msgtype}`);
      }
    } catch (error) {
      logger.error('Error in room.message handler', error);
    }
  });

  // Room events (reactions, etc.)
  client.on('room.event', async (roomId: string, event: MatrixMessageEvent) => {
    try {
      if (event.content['m.relates_to']?.rel_type === 'm.annotation') {
        await handleReaction(client, roomId, event, config, agentClient);
      }
    } catch (error) {
      logger.error('Error in room.event handler', error);
    }
  });

  logger.success('Event listeners configured');
}

/**
 * Handle proactive message from agent
 */
async function handleProactiveMessage(
  client: MatrixClient,
  message: ProactiveMessage,
): Promise<ProactiveResponse> {
  try {
    logger.info(`📬 Proactive message from agent: ${message.trigger}`);

    // Send to user
    await sendTextMessage(client, message.room_id, message.content);

    logger.success('Proactive message sent');

    return {
      type: 'success',
      message: 'Message sent',
    };
  } catch (error) {
    logger.error('Failed to send proactive message', error);

    return {
      type: 'error',
      error: String(error),
    };
  }
}

// Run main function
if (import.meta.main) {
  main();
}
