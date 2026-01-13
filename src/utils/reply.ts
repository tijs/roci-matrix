/**
 * Reply handling utilities
 */

/**
 * Strip reply fallback from message body.
 * Matrix includes quoted text in replies (lines starting with "> ").
 */
export function stripReplyFallback(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  // Skip lines starting with "> "
  while (i < lines.length && lines[i].startsWith('> ')) {
    i++;
  }
  // Skip empty line after quote block
  if (i < lines.length && lines[i] === '') {
    i++;
  }
  return lines.slice(i).join('\n');
}
