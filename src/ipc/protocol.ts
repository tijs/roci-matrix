/**
 * IPC Protocol utilities
 * Length-prefixed JSON messages over Unix sockets
 */

/**
 * Encode message to length-prefixed format
 * Format: 4-byte big-endian length + UTF-8 JSON
 */
export function encodeMessage(message: unknown): Uint8Array {
  const json = JSON.stringify(message);
  const data = new TextEncoder().encode(json);

  // Create 4-byte big-endian length prefix
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length, false); // false = big-endian

  // Combine length + data
  const result = new Uint8Array(4 + data.length);
  result.set(length);
  result.set(data, 4);

  return result;
}

/**
 * Decode message from length-prefixed format
 * Returns null if not enough data
 */
export function decodeMessage(buffer: Uint8Array): {
  message: Record<string, unknown>;
  remaining: Uint8Array;
} | null {
  // Need at least 4 bytes for length
  if (buffer.length < 4) {
    return null;
  }

  // Read length (4-byte big-endian)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint32(0, false); // false = big-endian

  // Check if we have enough data
  if (buffer.length < 4 + length) {
    return null;
  }

  // Extract message
  const messageBytes = buffer.slice(4, 4 + length);
  const remaining = buffer.slice(4 + length);

  try {
    const messageText = new TextDecoder().decode(messageBytes);
    const message = JSON.parse(messageText);
    return { message, remaining };
  } catch (error) {
    throw new Error(`Failed to decode IPC message: ${error}`);
  }
}

/**
 * Read exactly numBytes from a connection
 */
export async function readExactly(conn: Deno.Conn, numBytes: number): Promise<Uint8Array> {
  const result = new Uint8Array(numBytes);
  let offset = 0;

  while (offset < numBytes) {
    const chunk = new Uint8Array(numBytes - offset);
    const bytesRead = await conn.read(chunk);

    if (bytesRead === null) {
      throw new Error('Connection closed before reading complete message');
    }

    result.set(chunk.slice(0, bytesRead), offset);
    offset += bytesRead;
  }

  return result;
}
