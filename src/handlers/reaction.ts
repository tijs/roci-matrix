/**
 * Reaction handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import type { Config, MatrixMessageEvent } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo } from '../matrix/client.ts';
import { validateAuthorization } from '../utils/auth.ts';
import * as logger from '../utils/logger.ts';

/**
 * Handle reaction event
 */
export async function handleReaction(
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
      logger.debug(`Ignoring reaction: ${auth.reason}`);
      return;
    }

    // Extract reaction info
    const relatesTo = event.content['m.relates_to'];
    if (!relatesTo || relatesTo.rel_type !== 'm.annotation') {
      logger.debug('Not a reaction event');
      return;
    }

    const targetEventId = relatesTo.event_id;
    const reaction = relatesTo.key || '';

    logger.info(
      `👍 Reaction from ${event.sender}: ${reaction} on ${targetEventId}`,
    );

    // Forward to agent via IPC (fire-and-forget, no response needed)
    const ipcMessage = {
      type: 'user_reaction' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      reacted_to_event_id: targetEventId,
      reaction: reaction,
      timestamp: new Date(event.origin_server_ts).toISOString(),
    };

    // Fire-and-forget: reactions are informational, don't need response
    // Failures logged but non-critical (reactions enhance UX, not core functionality)
    agentClient.sendMessage(ipcMessage).catch((error) => {
      logger.error('Failed to send reaction to agent', error);
    });
  } catch (error) {
    logger.error('Error handling reaction', error);
  }
}
