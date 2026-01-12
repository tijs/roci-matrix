/**
 * Matrix Client setup
 * Initializes Matrix client with E2E encryption
 */

import {
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
} from 'matrix-bot-sdk';
import type { Config, ImageToSend } from '../types.ts';
import * as logger from '../utils/logger.ts';
import { getImageDimensions, uploadMedia } from './media.ts';

/**
 * Retry configuration for Matrix operations
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Check if an error is retryable (network/timeout errors)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const code = (error as Error & { code?: string }).code;
    return (
      code === 'ESOCKETTIMEDOUT' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      message.includes('timeout') ||
      message.includes('socket hang up') ||
      message.includes('network')
    );
  }
  return false;
}

/**
 * Execute an async operation with exponential backoff retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === RETRY_CONFIG.maxAttempts) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1) +
          Math.random() * 500,
        RETRY_CONFIG.maxDelayMs,
      );

      logger.warn(
        `${operationName} failed (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}), ` +
          `retrying in ${Math.round(delay)}ms: ${error}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Sync HTTP timeout configuration
 * The SDK defaults to 40s for sync requests, but this can cause timeouts
 * when the server is slow. We increase it to 90s to be safe.
 * (30s long-poll + 60s buffer for slow responses)
 */
const SYNC_HTTP_TIMEOUT = 90_000;

/**
 * Create and initialize Matrix client
 */
export function createMatrixClient(config: Config): MatrixClient {
  logger.info('Initializing Matrix client...');

  try {
    // Client state storage (sync state, etc.)
    const clientStorage = new SimpleFsStorageProvider(
      `${config.storeDir}/client-state.json`,
    );

    // E2E encryption storage (Rust SDK)
    // StoreType.Sled = 1 (file-based key-value store)
    const cryptoStorage = new RustSdkCryptoStorageProvider(
      `${config.storeDir}/crypto-sled`,
      1, // StoreType.Sled
    );

    // Create client
    const client = new MatrixClient(
      config.homeserverUrl,
      config.accessToken,
      clientStorage,
      cryptoStorage,
    );

    // Set device ID (must match the one from login)
    // @ts-ignore: deviceId property exists but may not be in types
    client.deviceId = config.deviceId;

    // Patch doRequest to use longer timeout for sync operations
    // The SDK hardcodes 40s for sync, which causes timeouts on slow servers
    const originalDoRequest = client.doRequest.bind(client);
    // @ts-ignore: Patching internal method
    client.doRequest = function (
      method: string,
      endpoint: string,
      qs?: unknown,
      body?: unknown,
      timeout?: number,
      raw?: boolean,
      contentType?: string,
      noEncoding?: boolean,
    ) {
      // Use longer timeout for sync requests
      if (endpoint.includes('/sync')) {
        timeout = SYNC_HTTP_TIMEOUT;
      }
      return originalDoRequest(method, endpoint, qs, body, timeout, raw, contentType, noEncoding);
    };

    logger.success(`Matrix client initialized for ${config.userId}`);
    logger.info(`Device ID: ${config.deviceId}`);
    logger.info(`Sync HTTP timeout: ${SYNC_HTTP_TIMEOUT}ms`);

    return client;
  } catch (error) {
    logger.error('Failed to initialize Matrix client', error);
    throw error;
  }
}

/**
 * Start Matrix client sync
 */
export async function startClient(client: MatrixClient): Promise<void> {
  try {
    logger.info('Starting Matrix client sync...');

    // Start the client (begins sync loop)
    await client.start();

    logger.success('Matrix client started and syncing');
  } catch (error) {
    logger.error('Failed to start Matrix client', error);
    throw error;
  }
}

/**
 * Get room information
 */
export async function getRoomInfo(
  client: MatrixClient,
  roomId: string,
): Promise<{ memberCount: number; encrypted: boolean }> {
  try {
    // Get joined members
    const members = await client.getJoinedRoomMembers(roomId);
    const memberCount = Object.keys(members).length;

    // Check if room is encrypted
    let encrypted = false;
    try {
      const state = await client.getRoomStateEvent(
        roomId,
        'm.room.encryption',
        '',
      );
      encrypted = state !== null;
    } catch {
      // Not encrypted
      encrypted = false;
    }

    return { memberCount, encrypted };
  } catch (error) {
    logger.error(`Failed to get room info for ${roomId}`, error);
    throw error;
  }
}

/**
 * Send text message to room with retry logic
 */
export async function sendTextMessage(
  client: MatrixClient,
  roomId: string,
  text: string,
): Promise<string> {
  try {
    const eventId = await withRetry(
      () => client.sendText(roomId, text),
      `sendTextMessage to ${roomId}`,
    );
    return eventId;
  } catch (error) {
    logger.error(`Failed to send message to ${roomId}`, error);
    throw error;
  }
}

/**
 * Send reaction to a message with retry logic
 */
export async function sendReaction(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  emoji: string,
): Promise<void> {
  try {
    await withRetry(
      () =>
        client.sendEvent(roomId, 'm.reaction', {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: eventId,
            key: emoji,
          },
        }),
      `sendReaction to ${eventId}`,
    );
  } catch (error) {
    logger.error(`Failed to send reaction to ${eventId}`, error);
    throw error;
  }
}

/**
 * Set typing indicator for room
 * Errors are logged but not thrown (typing is best-effort)
 */
export async function setTyping(
  client: MatrixClient,
  roomId: string,
  typing: boolean,
  timeout?: number,
): Promise<void> {
  try {
    await client.setTyping(roomId, typing, timeout);
    logger.debug(
      `Typing indicator ${typing ? 'started' : 'stopped'} for ${roomId}`,
    );
  } catch (error) {
    // Log but don't throw - typing failures shouldn't block messages
    logger.warn(`Failed to set typing indicator (typing=${typing}): ${error}`);
  }
}

/**
 * Get user ID from client
 */
export async function getUserId(client: MatrixClient): Promise<string> {
  return await client.getUserId();
}

/**
 * Send an image to a room
 * Handles E2E encryption automatically for encrypted rooms
 */
export async function sendImage(
  client: MatrixClient,
  roomId: string,
  image: ImageToSend,
): Promise<string> {
  try {
    logger.info(`Uploading image: ${image.filename}`);

    // Check if room is encrypted
    let isEncrypted = false;
    try {
      const state = await client.getRoomStateEvent(
        roomId,
        'm.room.encryption',
        '',
      );
      isEncrypted = state !== null;
    } catch {
      isEncrypted = false;
    }

    // Upload media (encrypted if room is encrypted)
    const uploadResult = await uploadMedia(
      client,
      image.file_path,
      image.mime_type,
      image.filename,
      isEncrypted,
    );

    // Get image dimensions
    const dimensions = await getImageDimensions(image.file_path);

    // Build message content
    const content: Record<string, unknown> = {
      msgtype: 'm.image',
      body: image.filename,
      info: {
        mimetype: image.mime_type,
        size: uploadResult.size,
        ...(dimensions && { w: dimensions.width, h: dimensions.height }),
      },
    };

    if (uploadResult.encrypted) {
      // For encrypted media, use 'file' instead of 'url'
      content.file = {
        url: uploadResult.mxcUrl,
        ...uploadResult.encrypted,
      };
    } else {
      content.url = uploadResult.mxcUrl;
    }

    // Send the image message with retry
    const eventId = await withRetry(
      () => client.sendMessage(roomId, content),
      `sendImage ${image.filename} to ${roomId}`,
    );
    logger.success(`Sent image: ${image.filename} (${eventId})`);

    return eventId;
  } catch (error) {
    logger.error(`Failed to send image: ${image.filename}`, error);
    throw error;
  }
}
