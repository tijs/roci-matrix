/**
 * Device verification handling
 *
 * Manual verification via Element client is required for E2E encryption.
 * Unlike matrix-nio (Python), matrix-bot-sdk doesn't expose high-level SAS verification APIs.
 *
 * To verify the bot device:
 * 1. Log in to Element as @roci:envs.net (the bot account)
 * 2. Go to Settings → Security & Privacy
 * 3. Find the "Roci Bot (Deno)" device in the device list
 * 4. Click "Verify" and complete the emoji/decimal verification
 * 5. Once verified, the bot can send/receive encrypted messages
 *
 * This only needs to be done once per device.
 */

import { MatrixClient } from 'matrix-bot-sdk';
import type { Config } from '../types.ts';
import * as logger from '../utils/logger.ts';

/**
 * Log verification status on startup
 */
export function setupAutoVerification(client: MatrixClient, config: Config): void {
  logger.info('Device verification: Manual via Element client');
  logger.info(`Device ID: ${config.deviceId}`);
  logger.info(`Device name: Roci Bot (Deno)`);
}
