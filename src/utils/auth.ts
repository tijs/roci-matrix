/**
 * Authorization utilities
 */

import type { Config } from '../types.ts';
import type { MatrixRoom } from '../types.ts';

/**
 * Check if a message should be processed
 */
export function shouldProcessMessage(params: {
  sender: string;
  botUserId: string;
  authorizedUser: string;
  memberCount: number;
}): boolean {
  const { sender, botUserId, authorizedUser, memberCount } = params;

  // Reject self-messages
  if (sender === botUserId) {
    return false;
  }

  // Reject unauthorized users
  if (sender !== authorizedUser) {
    return false;
  }

  // Reject non-DM rooms (must be exactly 2 members)
  if (memberCount !== 2) {
    return false;
  }

  return true;
}

/**
 * Validate authorization for an event
 */
export function validateAuthorization(
  sender: string,
  roomMemberCount: number,
  config: Config,
): { authorized: boolean; reason?: string } {
  if (sender === config.userId) {
    return { authorized: false, reason: 'self-message' };
  }

  if (sender !== config.authorizedUser) {
    return { authorized: false, reason: `unauthorized user: ${sender}` };
  }

  if (roomMemberCount !== 2) {
    return {
      authorized: false,
      reason: `non-DM room (${roomMemberCount} members)`,
    };
  }

  return { authorized: true };
}

/**
 * Check if room is a DM (2 members)
 */
export function isDMRoom(room: MatrixRoom): boolean {
  return room.joinedMemberCount === 2;
}

/**
 * Sanitize filename for logging
 */
export function sanitizeFilename(
  filename: string,
  maxLength: number = 200,
): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  // Preserve extension
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return filename.slice(0, maxLength - ext.length) + ext;
}
