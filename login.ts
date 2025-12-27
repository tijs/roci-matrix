/**
 * One-time login script
 * Gets access token and device ID for .env
 */

import { MatrixClient, SimpleFsStorageProvider } from 'matrix-bot-sdk';
import { load } from '@std/dotenv';

async function login() {
  // Load environment
  await load({ export: true });

  const homeserver = Deno.env.get('MATRIX_HOMESERVER');
  const userId = Deno.env.get('MATRIX_USER_ID');

  if (!homeserver || !userId) {
    console.error('❌ Missing MATRIX_HOMESERVER or MATRIX_USER_ID in .env');
    Deno.exit(1);
  }

  // Prompt for password
  console.log(`🔐 Logging in to ${homeserver} as ${userId}`);
  console.log('');

  const password = prompt('Enter password:');
  if (!password) {
    console.error('❌ Password required');
    Deno.exit(1);
  }

  try {
    // Create temporary client
    const storage = new SimpleFsStorageProvider('./store/login-temp.json');
    const client = new MatrixClient(homeserver, '', storage);

    // Login with password
    console.log('⏳ Logging in...');

    // Extract localpart from full user ID (@roci:envs.net -> roci)
    const username = userId.startsWith('@') ? userId.split(':')[0].substring(1) : userId;

    const response = await client.doRequest(
      'POST',
      '/_matrix/client/r0/login',
      null,
      {
        type: 'm.login.password',
        identifier: {
          type: 'm.id.user',
          user: username,
        },
        password: password,
        initial_device_display_name: 'Roci Bot (Deno)',
      },
    );

    console.log('');
    console.log('✅ Login successful!');
    console.log('');
    console.log('Copy these values to your .env file:');
    console.log('');
    console.log(`MATRIX_ACCESS_TOKEN=${response.access_token}`);
    console.log(`MATRIX_DEVICE_ID=${response.device_id}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Update .env with the values above');
    console.log('2. Run the Matrix service: deno task start');
    console.log('3. Login to Element and verify the new device (one-time)');
    console.log('');

    // Clean up temp file
    try {
      await Deno.remove('./store/login-temp.json');
    } catch {
      // Ignore
    }
  } catch (error) {
    console.error('❌ Login failed:', error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await login();
}
