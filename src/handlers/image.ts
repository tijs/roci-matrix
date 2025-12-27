/**
 * Image message handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import type { AgentResponse, Config, EncryptedMediaInfo, MatrixMessageEvent } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo, sendReaction, sendTextMessage } from '../matrix/client.ts';
import { downloadMedia } from '../matrix/media.ts';
import { validateAuthorization } from '../utils/auth.ts';
import { normalizeImageMimeType } from '../utils/media-validation.ts';
import * as logger from '../utils/logger.ts';

/**
 * Handle image message event
 */
export async function handleImageMessage(
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
    const auth = validateAuthorization(event.sender, roomInfo.memberCount, config);

    if (!auth.authorized) {
      logger.debug(`Ignoring image: ${auth.reason}`);
      return;
    }

    logger.info(`📷 Image from ${event.sender}`);

    // Determine if encrypted
    const isEncrypted = event.content.file !== undefined;
    const mxcUrl = isEncrypted ? event.content.file!.url : event.content.url!;
    const encryptedInfo = isEncrypted
      ? (event.content.file as unknown as EncryptedMediaInfo)
      : undefined;

    // Extract metadata
    const filename = event.content.body || 'image';
    const rawMimeType = event.content.info?.mimetype || 'image/jpeg';
    const width = event.content.info?.w;
    const height = event.content.info?.h;

    // Validate and normalize MIME type
    let mimeType: string;
    try {
      mimeType = normalizeImageMimeType(rawMimeType);
      logger.debug(`MIME type normalized: ${rawMimeType} -> ${mimeType}`);
    } catch (error) {
      logger.error(`Invalid image MIME type: ${rawMimeType}`, error);
      await sendTextMessage(
        client,
        roomId,
        `❌ Unsupported image format: ${rawMimeType}. Please send JPEG, PNG, GIF, or WebP.`,
      );
      return;
    }

    logger.info(`Downloading image: ${filename} (${isEncrypted ? 'encrypted' : 'plain'})`);

    // Download and decrypt if needed
    const media = await downloadMedia(client, mxcUrl, encryptedInfo, filename, mimeType);

    // Add width/height to media data
    const imageData = {
      ...media,
      width,
      height,
    };

    // Forward to agent via IPC
    const ipcMessage = {
      type: 'user_message' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      content: event.content.body || '',
      image: {
        data: imageData.data,
        mime_type: imageData.mimeType,
        filename: imageData.filename,
        width: imageData.width,
        height: imageData.height,
        size: imageData.size,
      },
      timestamp: new Date(event.origin_server_ts).toISOString(),
    };

    const response = await agentClient.sendMessage(ipcMessage);

    // Handle agent response
    await handleAgentResponse(client, roomId, event.event_id, response);

    logger.success('Image processed successfully');
  } catch (error) {
    logger.error('Error handling image message', error);

    // Send error message to user
    try {
      await sendTextMessage(
        client,
        roomId,
        `❌ Error processing image: ${error}`,
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
      await sendTextMessage(client, roomId, response.content);
      break;

    case 'send_reaction':
      await sendReaction(client, roomId, originalEventId, response.reaction);
      break;

    case 'agent_response_with_reaction':
      await sendTextMessage(client, roomId, response.content);
      await sendReaction(client, roomId, originalEventId, response.reaction);
      break;

    case 'error':
      await sendTextMessage(client, roomId, `❌ ${response.error}`);
      break;
  }
}
