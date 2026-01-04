/**
 * Media handling - download, decrypt, upload, and encrypt images/files
 */

import { MatrixClient } from 'matrix-bot-sdk';
import { Buffer } from 'node:buffer';
import { encodeBase64 as denoEncodeBase64 } from '@std/encoding/base64';
import type { EncryptedMediaInfo, MediaData } from '../types.ts';
import * as logger from '../utils/logger.ts';

/**
 * Result of uploading media
 */
export interface UploadResult {
  mxcUrl: string;
  encrypted?: EncryptedMediaInfo;
  size: number;
}

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
        encryptedInfo as unknown as Parameters<
          typeof client.crypto.decryptMedia
        >[0],
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

/**
 * Upload media to Matrix
 *
 * @param client Matrix client
 * @param filePath Path to file on disk
 * @param mimeType MIME type of the file
 * @param filename Filename to use
 * @param encrypt Whether to encrypt the media (for E2E rooms)
 * @returns Upload result with mxc:// URL and optional encryption info
 */
export async function uploadMedia(
  client: MatrixClient,
  filePath: string,
  mimeType: string,
  filename: string,
  encrypt: boolean = true,
): Promise<UploadResult> {
  try {
    // Read file from disk
    const fileData = await Deno.readFile(filePath);
    logger.debug(`Read file: ${filePath} (${fileData.length} bytes)`);

    if (encrypt) {
      // Encrypt media for E2E rooms
      logger.debug('Encrypting media for E2E room');
      const encrypted = await client.crypto.encryptMedia(Buffer.from(fileData));

      // Upload encrypted content
      const mxcUrl = await client.uploadContent(
        encrypted.buffer,
        mimeType,
        filename,
      );

      logger.info(`Uploaded encrypted media: ${mxcUrl}`);

      return {
        mxcUrl,
        encrypted: encrypted.file as unknown as EncryptedMediaInfo,
        size: fileData.length,
      };
    } else {
      // Upload unencrypted
      const mxcUrl = await client.uploadContent(
        Buffer.from(fileData),
        mimeType,
        filename,
      );

      logger.info(`Uploaded media: ${mxcUrl}`);

      return {
        mxcUrl,
        size: fileData.length,
      };
    }
  } catch (error) {
    logger.error(`Failed to upload media: ${filePath}`, error);
    throw error;
  }
}

/**
 * Get image dimensions from file (basic implementation for JPEG/PNG)
 * Returns undefined if dimensions cannot be determined
 */
export async function getImageDimensions(
  filePath: string,
): Promise<{ width: number; height: number } | undefined> {
  try {
    const data = await Deno.readFile(filePath);

    // PNG signature and IHDR chunk
    if (
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e &&
      data[3] === 0x47
    ) {
      // PNG: width at offset 16, height at offset 20 (big-endian)
      const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) |
        data[19];
      const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) |
        data[23];
      return { width, height };
    }

    // JPEG: search for SOF0 marker (0xFF 0xC0) or SOF2 (0xFF 0xC2)
    if (data[0] === 0xff && data[1] === 0xd8) {
      let offset = 2;
      while (offset < data.length - 8) {
        if (data[offset] !== 0xff) {
          offset++;
          continue;
        }

        const marker = data[offset + 1];
        // SOF0, SOF1, SOF2 markers
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = (data[offset + 5] << 8) | data[offset + 6];
          const width = (data[offset + 7] << 8) | data[offset + 8];
          return { width, height };
        }

        // Skip to next marker
        const length = (data[offset + 2] << 8) | data[offset + 3];
        offset += 2 + length;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}
