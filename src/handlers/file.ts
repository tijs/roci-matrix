/**
 * File attachment handler
 */

import { MatrixClient } from 'matrix-bot-sdk';
import { generateCorrelationId } from '@roci/shared';
import type { AgentResponse, Config, EncryptedMediaInfo, MatrixMessageEvent } from '../types.ts';
import { AgentIPCClient } from '../ipc/agent-client.ts';
import { getRoomInfo, sendReaction, sendTextMessage, setTyping } from '../matrix/client.ts';
import { downloadMedia } from '../matrix/media.ts';
import { validateAuthorization } from '../utils/auth.ts';
import { getExtensionFromMimeType } from '../utils/media-validation.ts';
import * as logger from '../utils/logger.ts';

// File size limit (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Allowed MIME types - Claude API supports these via Files API and vision
const ALLOWED_MIME_TYPES = [
  'application/pdf', // PDF via vision
  'text/plain', // TXT
  'text/markdown', // MD
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/msword', // DOC
  'application/rtf', // RTF
  'text/rtf', // RTF alternative
  'application/vnd.oasis.opendocument.text', // ODT
  'text/html', // HTML
  'application/xhtml+xml', // XHTML
  'application/epub+zip', // EPUB
  'application/json', // JSON
  'text/csv', // CSV
];

/**
 * Handle file message event
 * @param textContent - Optional text from a preceding m.text message (aggregated caption)
 */
export async function handleFileMessage(
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
      logger.debug(`Ignoring file: ${auth.reason}`);
      return;
    }

    // Generate correlation ID for request tracing
    const correlationId = generateCorrelationId();

    logger.info(
      `📄 [${correlationId}] File from ${event.sender}${
        textContent ? ` (with text: "${textContent.slice(0, 50)}...")` : ''
      }`,
    );

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
        `❌ Unsupported file type. Supported: PDF, DOCX, TXT, MD, RTF, ODT, HTML, EPUB, JSON, CSV.`,
      );
      return;
    }

    logger.debug(`File type: ${mimeType}, size: ${size} bytes`);

    // Determine if encrypted
    const isEncrypted = event.content.file !== undefined;
    const mxcUrl = isEncrypted ? event.content.file!.url : event.content.url!;
    const encryptedInfo = isEncrypted
      ? (event.content.file as unknown as EncryptedMediaInfo)
      : undefined;

    logger.info(
      `Downloading file: ${filename} (${isEncrypted ? 'encrypted' : 'plain'})`,
    );

    // Download and decrypt if needed
    const media = await downloadMedia(
      client,
      mxcUrl,
      encryptedInfo,
      filename,
      mimeType,
    );

    logger.debug(`File downloaded and decrypted: ${media.size} bytes`);

    // Use persistent attachments directory organized by date
    const attachmentsDir = '/home/tijs/roci/state/attachments';
    const dateDir = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const tempDir = `${attachmentsDir}/by-date/${dateDir}`;
    await Deno.mkdir(tempDir, { recursive: true });

    // Ensure README exists
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

    // Get file extension from MIME type (preferred) or filename (fallback)
    const ext = getExtensionFromMimeType(mimeType, filename);
    const tempFile = `${tempDir}/${event.event_id}.${ext}`;

    // Decode base64 and write to file
    const fileBytes = Uint8Array.from(atob(media.data), (c) => c.charCodeAt(0));
    await Deno.writeFile(tempFile, fileBytes);

    logger.debug(`File written to: ${tempFile}`);

    // Log metadata entry
    const metadataEntry = {
      t: new Date().toISOString(),
      event_id: event.event_id,
      filename: filename,
      mime_type: mimeType,
      size: fileBytes.length,
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
    // Note: event.content.body for files is typically the filename, not user text
    const ipcMessage = {
      type: 'user_message' as const,
      message_id: event.event_id,
      user_id: event.sender,
      room_id: roomId,
      content: textContent || event.content.body || '',
      attachments: [
        {
          type: 'document' as const,
          file_path: tempFile,
          mime_type: media.mimeType,
          filename: media.filename,
          size: media.size,
        },
      ],
      timestamp: new Date(event.origin_server_ts).toISOString(),
      correlationId,
    };

    logger.debug(`IPC message prepared, data size: ${media.data.length} chars`);

    // Fire-and-forget typing indicator - don't block message processing
    setTimeout(() => void setTyping(client, roomId, true), 500);

    logger.info('Sending file to agent via IPC...');

    try {
      const response = await agentClient.sendMessage(ipcMessage);

      logger.info('Received response from agent');

      void setTyping(client, roomId, false); // Stop before sending (non-blocking)

      // Handle agent response
      await handleAgentResponse(client, roomId, event.event_id, response);

      logger.success('File processed successfully');
    } finally {
      void setTyping(client, roomId, false); // Cleanup (non-blocking)
    }
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
