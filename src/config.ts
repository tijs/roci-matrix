/**
 * Configuration loader
 * Loads and validates environment variables
 */

import { load } from '@std/dotenv';
import type { Config } from './types.ts';

/**
 * Load configuration from environment
 */
export async function loadConfig(): Promise<Config> {
  // Load .env file
  await load({ export: true });

  // Required variables
  const requiredVars = [
    'MATRIX_HOMESERVER',
    'MATRIX_USER_ID',
    'MATRIX_ACCESS_TOKEN',
    'MATRIX_DEVICE_ID',
    'AUTHORIZED_USER',
  ];

  // Check required variables
  const missing = requiredVars.filter((name) => !Deno.env.get(name));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Build config
  const config: Config = {
    // Matrix
    homeserverUrl: Deno.env.get('MATRIX_HOMESERVER')!,
    userId: Deno.env.get('MATRIX_USER_ID')!,
    accessToken: Deno.env.get('MATRIX_ACCESS_TOKEN')!,
    deviceId: Deno.env.get('MATRIX_DEVICE_ID')!,
    authorizedUser: Deno.env.get('AUTHORIZED_USER')!,

    // IPC
    ipcSocketPath: Deno.env.get('IPC_SOCKET_PATH') || '/var/run/roci/agent.sock',
    ipcServerPath: Deno.env.get('IPC_SERVER_PATH') || '/var/run/roci/matrix.sock',

    // Storage
    storeDir: Deno.env.get('STORE_DIR') || './store',

    // Error tracking
    sentryDsn: Deno.env.get('SENTRY_DSN'),
  };

  // Validate Matrix user ID format
  if (!config.userId.startsWith('@') || !config.userId.includes(':')) {
    throw new Error(`Invalid MATRIX_USER_ID format: ${config.userId}`);
  }

  if (!config.authorizedUser.startsWith('@') || !config.authorizedUser.includes(':')) {
    throw new Error(`Invalid AUTHORIZED_USER format: ${config.authorizedUser}`);
  }

  // Validate homeserver URL
  if (!config.homeserverUrl.startsWith('http://') && !config.homeserverUrl.startsWith('https://')) {
    throw new Error(`Invalid MATRIX_HOMESERVER format: ${config.homeserverUrl}`);
  }

  return config;
}
