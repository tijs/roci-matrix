/**
 * Text message handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import type { AgentResponse, Config, MatrixMessageEvent } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo, sendReaction, sendTextMessage, setTyping } from '../matrix/client.ts';
import { validateAuthorization } from '../utils/auth.ts';
import * as logger from '../utils/logger.ts';

/**
 * Handle text message event
 */
export async function handleTextMessage(
  client: MatrixClient,
  roomId: string,
  event: MatrixMessageEvent,
  config: Config,
  agentClient: AgentIPCClient,
): Promise<void> {
  try {
    // Get room info
    const roomInfo = await getRoomInfo(client, roomId);

    // Validate authorization
    const auth = validateAuthorization(
      event.sender,
      roomInfo.memberCount,
      config,
    );

    if (!auth.authorized) {
      logger.debug(`Ignoring message: ${auth.reason}`);
      return;
    }

    // Extract message content
    const content = event.content.body;

    logger.info(`📨 Message from ${event.sender}: ${content.slice(0, 100)}`);

    // Forward to agent via IPC
    const ipcMessage = {
      type: 'user_message' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      content: content,
      timestamp: new Date(event.origin_server_ts).toISOString(),
    };

    // Natural delay before starting typing
    await new Promise((resolve) => setTimeout(resolve, 500));
    await setTyping(client, roomId, true);

    try {
      const response = await agentClient.sendMessage(ipcMessage);
      await setTyping(client, roomId, false); // Stop before sending
      await handleAgentResponse(client, roomId, event.event_id, response);
    } finally {
      await setTyping(client, roomId, false); // Cleanup
    }
  } catch (error) {
    logger.error('Error handling text message', error);

    // Send error message to user
    try {
      await sendTextMessage(
        client,
        roomId,
        `❌ Error processing message: ${error}`,
      );
    } catch (sendError) {
      logger.error('Failed to send error message', sendError);
    }
  }
}

/**
 * Handle agent response
 */
async function handleAgentResponse(
  client: MatrixClient,
  roomId: string,
  originalEventId: string,
  response: AgentResponse,
): Promise<void> {
  switch (response.type) {
    case 'agent_response':
      // Send text response
      logger.info(`💬 Agent response: ${response.content.slice(0, 100)}`);
      await sendTextMessage(client, roomId, response.content);
      break;

    case 'send_reaction':
      // Send only reaction
      logger.info(`👍 Agent reaction: ${response.reaction}`);
      await sendReaction(client, roomId, originalEventId, response.reaction);
      break;

    case 'agent_response_with_reaction':
      // Send both text and reaction
      logger.info(`💬👍 Agent response with reaction: ${response.reaction}`);
      await sendTextMessage(client, roomId, response.content);
      await sendReaction(client, roomId, originalEventId, response.reaction);
      break;

    case 'error':
      // Send error message
      logger.error(`Agent error: ${response.error}`);
      await sendTextMessage(client, roomId, `❌ ${response.error}`);
      break;

    default:
      logger.error(
        `Unknown agent response type: ${(response as { type: string }).type}`,
      );
  }
}
