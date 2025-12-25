/**
 * Device verification handling
 * Auto-accepts verification from same user account
 */

import { MatrixClient } from 'matrix-bot-sdk';
import type { Config } from '../types.ts';
import * as logger from '../utils/logger.ts';

/**
 * Set up auto-verification for devices from same user
 */
export function setupAutoVerification(client: MatrixClient, config: Config): void {
  // Listen for verification requests
  client.on('room.event', async (roomId: string, event: any) => {
    try {
      // Check for verification request events
      if (event.type === 'm.key.verification.request') {
        await handleVerificationRequest(client, event, config);
      } else if (event.type === 'm.key.verification.start') {
        await handleVerificationStart(client, event, config);
      } else if (event.type === 'm.key.verification.ready') {
        logger.debug('Verification ready event received');
      }
    } catch (error) {
      logger.error('Error handling verification event', error);
    }
  });

  logger.info('Auto-verification configured (same-user devices)');
}

/**
 * Handle verification request
 */
async function handleVerificationRequest(
  client: MatrixClient,
  event: any,
  config: Config,
): Promise<void> {
  // Only auto-verify if it's from the same user (own devices)
  if (event.sender !== config.userId) {
    logger.debug(`Ignoring verification request from ${event.sender} (not same user)`);
    return;
  }

  logger.info(`📱 Verification request from own device: ${event.sender}`);

  try {
    // Accept the verification request
    const transactionId = event.content?.transaction_id;

    if (transactionId) {
      // Send m.key.verification.ready
      await client.sendEvent(event.room_id || event.sender, 'm.key.verification.ready', {
        transaction_id: transactionId,
        methods: ['m.sas.v1'],
        from_device: config.deviceId,
      });

      logger.success('✅ Verification request accepted');
    }
  } catch (error) {
    logger.error('Failed to accept verification request', error);
  }
}

/**
 * Handle verification start
 */
async function handleVerificationStart(
  client: MatrixClient,
  event: any,
  config: Config,
): Promise<void> {
  // Only auto-verify if it's from the same user
  if (event.sender !== config.userId) {
    logger.debug(`Ignoring verification start from ${event.sender} (not same user)`);
    return;
  }

  logger.info(`🔐 Verification started with own device`);

  try {
    const transactionId = event.content?.transaction_id;

    if (transactionId && event.content?.method === 'm.sas.v1') {
      // Send m.key.verification.accept
      await client.sendEvent(event.room_id || event.sender, 'm.key.verification.accept', {
        transaction_id: transactionId,
        method: 'm.sas.v1',
        key_agreement_protocol: 'curve25519-hkdf-sha256',
        hash: 'sha256',
        message_authentication_code: 'hkdf-hmac-sha256.v2',
        short_authentication_string: ['decimal', 'emoji'],
      });

      logger.success('✅ SAS verification accepted');
    }
  } catch (error) {
    logger.error('Failed to handle verification start', error);
  }
}
