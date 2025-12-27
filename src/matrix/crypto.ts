/**
 * E2E Encryption handling
 */

import { MatrixClient } from 'matrix-bot-sdk';
import * as logger from '../utils/logger.ts';

/**
 * Set up encryption event listeners
 */
export function setupEncryptionListeners(client: MatrixClient): void {
  // Monitor decryption failures
  client.on(
    'room.failed_decryption',
    (roomId: string, event: unknown, error: Error) => {
      // Ignore "no session found" for old messages (expected behavior)
      if (error.message && error.message.includes('no session found')) {
        return;
      }

      logger.error(`Decryption failed in ${roomId}`, {
        // @ts-ignore: event_id may exist
        eventId: event?.event_id,
        error: error.message,
      });
    },
  );

  // Optional: Log successful decryptions in debug mode
  client.on('room.decrypted_event', (roomId: string, event: unknown) => {
    // @ts-ignore: event_id may exist
    logger.debug(`Message decrypted: ${event?.event_id} in ${roomId}`);
  });

  logger.info('Encryption listeners configured');
}

/**
 * Verify E2E encryption is enabled
 */
export function verifyEncryption(client: MatrixClient): boolean {
  try {
    // Check if crypto is available
    // @ts-ignore: crypto property exists but may not be in types
    if (!client.crypto) {
      logger.warn('E2E encryption not available on this client');
      return false;
    }

    logger.success('E2E encryption is enabled');
    return true;
  } catch (error) {
    logger.error('Failed to verify encryption', error);
    return false;
  }
}
