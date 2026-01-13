/**
 * Type definitions for roci-matrix
 */

// ============ Configuration ============

export interface Config {
  // Matrix
  homeserverUrl: string;
  userId: string;
  accessToken: string;
  deviceId: string;
  authorizedUser: string;

  // IPC
  ipcSocketPath: string;
  ipcServerPath: string;

  // Storage
  storeDir: string;

  // Error tracking
  sentryDsn?: string;
}

// ============ IPC Messages ============

/**
 * Context for reply messages
 */
export interface ReplyContext {
  event_id: string;
  sender: string;
  content: string;
  timestamp: string;
}

/**
 * Message from Matrix → Agent
 */
export interface UserMessage {
  type: 'user_message';
  message_id: string;
  user_id: string;
  room_id: string;
  content: string;
  image?: ImageAttachment;
  attachments?: FileAttachment[];
  reply_to?: ReplyContext;
  timestamp: string;
}

/**
 * User reaction event (Matrix → Agent)
 */
export interface UserReaction {
  type: 'user_reaction';
  message_id: string;
  user_id: string;
  room_id: string;
  reacted_to_event_id: string;
  reaction: string;
  timestamp: string;
}

/**
 * Image attachment data
 */
export interface ImageAttachment {
  file_path: string; // Temp file path (avoids IPC buffer issues)
  mime_type: string;
  filename: string;
  width?: number;
  height?: number;
  size: number;
}

/**
 * File attachment data
 */
export interface FileAttachment {
  type: 'document';
  file_path: string; // Temp file path (avoids IPC buffer issues)
  mime_type: string;
  filename: string;
  size: number;
}

/**
 * Response from Agent → Matrix
 */
export type AgentResponse =
  | AgentTextResponse
  | AgentReactionResponse
  | AgentTextAndReactionResponse
  | AgentErrorResponse;

/**
 * Agent sends text response
 */
export interface AgentTextResponse {
  type: 'agent_response';
  message_id: string;
  content: string;
  actions?: string[];
  timestamp: string;
}

/**
 * Agent sends only reaction
 */
export interface AgentReactionResponse {
  type: 'send_reaction';
  message_id: string;
  reaction: string;
  timestamp: string;
}

/**
 * Agent sends both text and reaction
 */
export interface AgentTextAndReactionResponse {
  type: 'agent_response_with_reaction';
  message_id: string;
  content: string;
  reaction: string;
  actions?: string[];
  timestamp: string;
}

/**
 * Agent error response
 */
export interface AgentErrorResponse {
  type: 'error';
  error: string;
  timestamp: string;
}

/**
 * Proactive message from Agent → Matrix
 */
export interface ProactiveMessage {
  type: 'proactive_message';
  user_id: string;
  room_id: string;
  content: string;
  trigger: string;
  timestamp: string;
}

/**
 * Image response from Agent → Matrix
 * Sends generated images to the user
 */
export interface AgentImageMessage {
  type: 'agent_image';
  room_id: string;
  images: ImageToSend[];
  caption?: string;
  timestamp: string;
}

/**
 * Image to upload and send
 */
export interface ImageToSend {
  file_path: string;
  mime_type: string;
  filename: string;
}

/**
 * Response to proactive message
 */
export interface ProactiveResponse {
  type: 'success' | 'error';
  message?: string;
  error?: string;
}

// ============ Matrix Event Types ============

/**
 * Matrix message event
 */
export interface MatrixMessageEvent {
  event_id: string;
  sender: string;
  room_id: string;
  content: {
    msgtype: string;
    body: string;
    // Image/file specific
    info?: {
      mimetype?: string;
      size?: number;
      w?: number;
      h?: number;
    };
    url?: string; // MXC URL for unencrypted media
    file?: {
      // Encrypted media
      url: string; // MXC URL
      key: {
        // JWK
        kty: string;
        key_ops: string[];
        alg: string;
        k: string;
        ext: boolean;
      };
      iv: string;
      hashes: {
        sha256: string;
      };
      v: string;
    };
    // Reaction and reply specific
    'm.relates_to'?: {
      rel_type?: string; // For reactions
      event_id?: string; // For reactions
      key?: string; // Reaction emoji
      'm.in_reply_to'?: {
        // For replies
        event_id: string;
      };
    };
  };
  origin_server_ts: number;
}

/**
 * Matrix room
 */
export interface MatrixRoom {
  roomId: string;
  name?: string;
  topic?: string;
  joinedMemberCount: number;
  encrypted: boolean;
}

// ============ Media ============

/**
 * Media data (image or file)
 */
export interface MediaData {
  data: string; // Base64
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

/**
 * Decryption info for encrypted media
 */
export interface EncryptedMediaInfo {
  key: {
    kty: string;
    key_ops: string[];
    alg: string;
    k: string;
    ext: boolean;
  };
  iv: string;
  hashes: {
    sha256: string;
  };
  v: string;
}
