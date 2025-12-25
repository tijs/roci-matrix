/**
 * File attachment handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import type { AgentResponse, Config, EncryptedMediaInfo, MatrixMessageEvent } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo, sendReaction, sendTextMessage } from '../matrix/client.ts';
import { downloadMedia } from '../matrix/media.ts';
import { validateAuthorization } from '../utils/auth.ts';
import * as logger from '../utils/logger.ts';

// File size limit (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Allowed MIME types for RAG
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
];

/**
 * Handle file message event
 */
export async function handleFileMessage(
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
      logger.debug(`Ignoring file: ${auth.reason}`);
      return;
    }

    logger.info(`📄 File from ${event.sender}`);

    // Extract metadata
    const filename = event.content.body || 'file';
    const mimeType = event.content.info?.mimetype || 'application/octet-stream';
    const size = event.content.info?.size || 0;

    // Validate file size
    if (size > MAX_FILE_SIZE) {
      logger.warn(`File too large: ${size} bytes (max ${MAX_FILE_SIZE})`);
      await sendTextMessage(
        client,
        roomId,
        `❌ File too large. Maximum size is 50MB.`,
      );
      return;
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      logger.warn(`Unsupported file type: ${mimeType}`);
      await sendTextMessage(
        client,
        roomId,
        `❌ Unsupported file type. Supported: PDF, TXT, MD, DOCX.`,
      );
      return;
    }

    // Determine if encrypted
    const isEncrypted = event.content.file !== undefined;
    const mxcUrl = isEncrypted ? event.content.file!.url : event.content.url!;
    const encryptedInfo = isEncrypted
      ? (event.content.file as unknown as EncryptedMediaInfo)
      : undefined;

    logger.info(`Downloading file: ${filename} (${isEncrypted ? 'encrypted' : 'plain'})`);

    // Download and decrypt if needed
    const media = await downloadMedia(client, mxcUrl, encryptedInfo, filename, mimeType);

    // Forward to agent via IPC
    const ipcMessage = {
      type: 'user_message' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      content: event.content.body || '',
      attachments: [
        {
          type: 'document' as const,
          data: media.data,
          mime_type: media.mimeType,
          filename: media.filename,
          size: media.size,
        },
      ],
      timestamp: new Date(event.origin_server_ts).toISOString(),
    };

    const response = await agentClient.sendMessage(ipcMessage);

    // Handle agent response
    await handleAgentResponse(client, roomId, event.event_id, response);

    logger.success('File processed successfully');
  } catch (error) {
    logger.error('Error handling file message', error);

    // Send error message to user
    try {
      await sendTextMessage(
        client,
        roomId,
        `❌ Error processing file: ${error}`,
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
