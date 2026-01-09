/**
 * Main entry point for roci-matrix service
 */

import { loadConfig } from './config.ts';
import { createMatrixClient, sendImage, sendTextMessage, startClient } from './matrix/client.ts';
import { setupEncryptionListeners, verifyEncryption } from './matrix/crypto.ts';
import { setupAutoVerification } from './matrix/verification.ts';
import { AgentIPCClient } from './ipc/agent-client.ts';
import { MatrixIPCServer } from './ipc/matrix-server.ts';
import { handleTextMessage } from './handlers/message.ts';
import { handleImageMessage } from './handlers/image.ts';
import { handleFileMessage } from './handlers/file.ts';
import { handleReaction } from './handlers/reaction.ts';
import { MessageAggregator } from './utils/message-aggregator.ts';
import type {
  AgentImageMessage,
  Config,
  MatrixMessageEvent,
  ProactiveMessage,
  ProactiveResponse,
} from './types.ts';
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
      async (message: AgentImageMessage): Promise<ProactiveResponse> => {
        return await handleAgentImageMessage(client, message);
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
  // Message aggregator to combine text + image messages sent together
  // When Element sends "Check this out" with an image, it sends TWO events:
  // 1. m.text with the caption
  // 2. m.image with the file
  // The aggregator waits briefly for the image after receiving text
  const aggregator = new MessageAggregator(2000); // 2 second window

  // Room message events (text, images, files)
  client.on(
    'room.message',
    async (roomId: string, event: MatrixMessageEvent) => {
      try {
        const msgtype = event.content.msgtype;

        if (msgtype === 'm.text') {
          // Buffer text, wait for potential image
          await aggregator.handleText(
            roomId,
            event,
            // Called if no image arrives within window
            async (roomId, textEvent) => {
              await handleTextMessage(
                client,
                roomId,
                textEvent,
                config,
                agentClient,
              );
            },
          );
        } else if (msgtype === 'm.image') {
          // Check for pending text to combine
          await aggregator.handleImage(
            roomId,
            event,
            async (roomId, imageEvent, textContent) => {
              await handleImageMessage(
                client,
                roomId,
                imageEvent,
                config,
                agentClient,
                textContent,
              );
            },
          );
        } else if (msgtype === 'm.file') {
          // Check for pending text to combine
          await aggregator.handleFile(
            roomId,
            event,
            async (roomId, fileEvent, textContent) => {
              await handleFileMessage(
                client,
                roomId,
                fileEvent,
                config,
                agentClient,
                textContent,
              );
            },
          );
        } else {
          logger.debug(`Ignoring message type: ${msgtype}`);
        }
      } catch (error) {
        logger.error('Error in room.message handler', error);
      }
    },
  );

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

  logger.success('Event listeners configured (with message aggregation)');
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

/**
 * Handle image message from agent
 */
async function handleAgentImageMessage(
  client: MatrixClient,
  message: AgentImageMessage,
): Promise<ProactiveResponse> {
  try {
    logger.info(
      `🖼️ Image message from agent: ${message.images.length} image(s)`,
    );

    // Send each image
    for (const image of message.images) {
      await sendImage(client, message.room_id, image);
    }

    // Send caption if provided
    if (message.caption) {
      await sendTextMessage(client, message.room_id, message.caption);
    }

    logger.success(`Sent ${message.images.length} image(s)`);

    return {
      type: 'success',
      message: `Sent ${message.images.length} image(s)`,
    };
  } catch (error) {
    logger.error('Failed to send image message', error);

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
