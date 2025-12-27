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
    // Download from Matrix media server
    const buffer = await downloadFromMxc(client, mxcUrl);

    // Decrypt if encrypted
    let decryptedBuffer = buffer;
    if (encryptedInfo) {
      decryptedBuffer = await decryptMedia(buffer, encryptedInfo);
    }

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
 * Download raw bytes from MXC URL
 */
async function downloadFromMxc(client: MatrixClient, mxcUrl: string): Promise<Uint8Array> {
  try {
    // Convert MXC URL to HTTP URL
    const httpUrl = client.mxcToHttp(mxcUrl);

    // Download
    const response = await fetch(httpUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    logger.error(`Failed to download from ${mxcUrl}`, error);
    throw error;
  }
}

/**
 * Decrypt encrypted media
 * Uses AES-CTR with parameters from event
 */
async function decryptMedia(
  encryptedData: Uint8Array,
  info: EncryptedMediaInfo,
): Promise<Uint8Array> {
  try {
    // Import key from JWK
    const keyData = Uint8Array.from(atob(info.key.k), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-CTR' },
      false,
      ['decrypt'],
    );

    // Decode IV
    const iv = Uint8Array.from(atob(info.iv), (c) => c.charCodeAt(0));

    // Decrypt
    // Create a proper Uint8Array with ArrayBuffer (not ArrayBufferLike)
    const dataBuffer = new Uint8Array(encryptedData);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-CTR',
        counter: iv,
        length: 64,
      },
      key,
      dataBuffer,
    );

    const decryptedBytes = new Uint8Array(decrypted);

    // Verify hash if provided
    if (info.hashes.sha256) {
      const actualHash = await hashSHA256(decryptedBytes);
      const expectedHash = info.hashes.sha256.replace(/^sha256:/, '');

      if (actualHash !== expectedHash) {
        throw new Error('Hash verification failed - decrypted data corrupted');
      }
    }

    return decryptedBytes;
  } catch (error) {
    logger.error('Media decryption failed', error);
    throw error;
  }
}

/**
 * Calculate SHA256 hash of data
 */
async function hashSHA256(data: Uint8Array): Promise<string> {
  // Ensure we have a proper Uint8Array with ArrayBuffer
  const dataBuffer = new Uint8Array(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashBytes = new Uint8Array(hashBuffer);
  // Use Deno's native base64 encoding (prevents stack overflow for large data)
  return denoEncodeBase64(hashBytes);
}

/**
 * Base64 encode bytes using Deno's native encoding
 * Replaces btoa+spread operator which causes stack overflow for large images
 */
function encodeBase64(data: Uint8Array): string {
  return denoEncodeBase64(data);
}
