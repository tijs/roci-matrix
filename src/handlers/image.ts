/**
 * Image message handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import { generateCorrelationId } from '@roci/shared';
import type { AgentResponse, Config, EncryptedMediaInfo, MatrixMessageEvent } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo, sendReaction, sendTextMessage } from '../matrix/client.ts';
import { downloadMedia } from '../matrix/media.ts';
import { validateAuthorization } from '../utils/auth.ts';
import { normalizeImageMimeType } from '../utils/media-validation.ts';
import * as logger from '../utils/logger.ts';

/**
 * Handle image message event
 * @param textContent - Optional text from a preceding m.text message (aggregated caption)
 */
export async function handleImageMessage(
  client: MatrixClient,
  roomId: string,
  event: MatrixMessageEvent,
  config: Config,
  agentClient: AgentIPCClient,
  textContent?: string,
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
      logger.debug(`Ignoring image: ${auth.reason}`);
      return;
    }

    // Generate correlation ID for request tracing
    const correlationId = generateCorrelationId();

    logger.info(
      `📷 [${correlationId}] Image from ${event.sender}${
        textContent ? ` (with text: "${textContent.slice(0, 50)}...")` : ''
      }`,
    );

    // Debug: Log full event content
    logger.debug(
      `Raw event content: ${JSON.stringify(event.content, null, 2)}`,
    );

    // Determine if encrypted
    const isEncrypted = event.content.file !== undefined;
    const mxcUrl = isEncrypted ? event.content.file!.url : event.content.url!;
    const encryptedInfo = isEncrypted
      ? (event.content.file as unknown as EncryptedMediaInfo)
      : undefined;

    logger.debug(`MXC URL: ${mxcUrl}, encrypted: ${isEncrypted}`);

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

    logger.info(
      `Downloading image: ${filename} (${isEncrypted ? 'encrypted' : 'plain'})`,
    );

    // Download and decrypt if needed
    const media = await downloadMedia(
      client,
      mxcUrl,
      encryptedInfo,
      filename,
      mimeType,
    );

    logger.debug(`Media downloaded and decrypted: ${media.size} bytes`);

    // Use persistent attachments directory organized by date
    const attachmentsDir = '/home/tijs/roci/state/attachments';
    const dateDir = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const tempDir = `${attachmentsDir}/by-date/${dateDir}`;
    await Deno.mkdir(tempDir, { recursive: true });

    // Ensure README exists (same as file handler)
    const readmePath = `${attachmentsDir}/README.md`;
    try {
      await Deno.stat(readmePath);
    } catch {
      await Deno.writeTextFile(
        readmePath,
        `# Attachments Directory

This directory stores all files and images uploaded via Matrix.

## Structure

- \`by-date/YYYY-MM-DD/\` - Files organized by upload date
- \`metadata.jsonl\` - Searchable index of all uploads

## Metadata Format

Each line is a JSON object with:
- t: timestamp
- event_id: Matrix event ID
- filename: original filename
- path: full path to file
- mime_type, size, user_id
- indexed: whether file is in RAG index

## Querying

Use jq to search metadata:

\`\`\`bash
# Files uploaded today
jq 'select(.t | startswith("${dateDir}"))' metadata.jsonl

# All PDFs
jq 'select(.mime_type == "application/pdf")' metadata.jsonl

# Not yet indexed
jq 'select(.indexed == false)' metadata.jsonl
\`\`\`
`,
      );
    }

    const tempFile = `${tempDir}/${event.event_id}.${mimeType.split('/')[1]}`;

    // Decode base64 and write to file
    const imageBytes = Uint8Array.from(
      atob(media.data),
      (c) => c.charCodeAt(0),
    );
    await Deno.writeFile(tempFile, imageBytes);

    logger.debug(`Image written to: ${tempFile}`);

    // Log metadata entry
    const metadataEntry = {
      t: new Date().toISOString(),
      event_id: event.event_id,
      filename: filename,
      mime_type: mimeType,
      size: imageBytes.length,
      path: tempFile,
      user_id: event.sender,
      indexed: false,
    };

    const metadataPath = `${attachmentsDir}/metadata.jsonl`;
    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify(metadataEntry) + '\n',
      { append: true },
    );

    logger.debug(`Metadata logged to ${metadataPath}`);

    // Forward to agent via IPC with file path instead of data
    // Use textContent (from aggregated text message) if provided, otherwise use event body
    // Note: event.content.body for images is typically the filename, not user text
    const ipcMessage = {
      type: 'user_message' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      content: textContent || event.content.body || '',
      image: {
        file_path: tempFile,
        mime_type: media.mimeType,
        filename: media.filename,
        width,
        height,
        size: media.size,
      },
      timestamp: new Date(event.origin_server_ts).toISOString(),
      correlationId,
    };

    logger.info('Sending image metadata to agent via IPC...');

    const response = await agentClient.sendMessage(ipcMessage);
    // Note: temp file cleanup is handled by agent after reading
    logger.info('Received response from agent');

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
