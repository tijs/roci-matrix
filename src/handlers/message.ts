/**
 * Text message handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import { generateCorrelationId } from '@roci/shared';
import type { AgentResponse, Config, MatrixMessageEvent, ReplyContext } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo, sendReaction, sendTextMessage, setTyping } from '../matrix/client.ts';
import { validateAuthorization } from '../utils/auth.ts';
import * as logger from '../utils/logger.ts';
import { stripReplyFallback } from '../utils/reply.ts';

/**
 * Fetch reply context for a message that's replying to another message.
 */
async function getReplyContext(
  client: MatrixClient,
  roomId: string,
  event: MatrixMessageEvent,
): Promise<ReplyContext | undefined> {
  const inReplyTo = event.content['m.relates_to']?.['m.in_reply_to'];
  if (!inReplyTo?.event_id) return undefined;

  try {
    // Cast to raw object since SDK wrapper types differ between versions
    const originalEvent = (await client.getEvent(roomId, inReplyTo.event_id)) as unknown as {
      event_id: string;
      sender: string;
      content?: { body?: string };
      origin_server_ts: number;
    };
    return {
      event_id: originalEvent.event_id,
      sender: originalEvent.sender,
      content: originalEvent.content?.body || '[no content]',
      timestamp: new Date(originalEvent.origin_server_ts).toISOString(),
    };
  } catch (error) {
    logger.warn(`Failed to fetch reply context: ${error}`);
    return undefined;
  }
}

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

    // Check if this is a reply and get context
    const replyContext = await getReplyContext(client, roomId, event);

    // Extract message content (strip fallback if replying)
    const content = replyContext ? stripReplyFallback(event.content.body) : event.content.body;

    // Generate correlation ID for request tracing
    const correlationId = generateCorrelationId();

    logger.info(
      `📨 [${correlationId}] Message from ${event.sender}${replyContext ? ' (reply)' : ''}: ${
        content.slice(0, 100)
      }`,
    );

    // Forward to agent via IPC
    const ipcMessage = {
      type: 'user_message' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      content: content,
      reply_to: replyContext,
      timestamp: new Date(event.origin_server_ts).toISOString(),
      correlationId,
    };

    // Fire-and-forget typing indicator - don't block message processing
    // If homeserver is slow/unresponsive, we don't want to delay the agent
    setTimeout(() => void setTyping(client, roomId, true), 500);

    try {
      const response = await agentClient.sendMessage(ipcMessage);
      void setTyping(client, roomId, false); // Stop before sending (non-blocking)
      await handleAgentResponse(client, roomId, event.event_id, response);
    } finally {
      void setTyping(client, roomId, false); // Cleanup (non-blocking)
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
