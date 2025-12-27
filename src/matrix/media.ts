/**
 * Media handling - download and decrypt images/files
 */

import { MatrixClient } from 'matrix-bot-sdk';
import { encodeBase64 as denoEncodeBase64 } from '@std/encoding/base64';
import type { EncryptedMediaInfo, MediaData } from '../types.ts';
import * as logger from '../utils/logger.ts';

/**
 * Download and optionally decrypt media from Matrix
 */
export async function downloadMedia(
  client: MatrixClient,
  mxcUrl: string,
  encryptedInfo?: EncryptedMediaInfo,
  filename?: string,
  mimeType?: string,
): Promise<MediaData> {
  try {
    let decryptedBuffer: Uint8Array;

    if (encryptedInfo) {
      // Use matrix-bot-sdk's built-in decryption for encrypted media
      logger.debug('Using client.crypto.decryptMedia() for encrypted media');
      const decrypted = await client.crypto.decryptMedia(
        encryptedInfo as unknown as Parameters<typeof client.crypto.decryptMedia>[0],
      );
      decryptedBuffer = new Uint8Array(decrypted);
    } else {
      // Download unencrypted media
      const response = await client.downloadContent(mxcUrl);
      decryptedBuffer = new Uint8Array(response.data);
    }

    logger.debug(`Media processed: ${decryptedBuffer.length} bytes`);

    // Base64 encode for IPC
    const base64 = encodeBase64(decryptedBuffer);

    return {
      data: base64,
      filename: filename || 'unknown',
      mimeType: mimeType || 'application/octet-stream',
      size: decryptedBuffer.length,
    };
  } catch (error) {
    logger.error('Failed to download media', error);
    throw error;
  }
}

/**
 * Base64 encode bytes using Deno's native encoding
 * Replaces btoa+spread operator which causes stack overflow for large images
 */
function encodeBase64(data: Uint8Array): string {
  return denoEncodeBase64(data);
}
