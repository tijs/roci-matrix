import { assertEquals } from '@std/assert';
import { describe, it } from '@std/testing/bdd';
import { stripReplyFallback } from '../../src/utils/reply.ts';

describe('stripReplyFallback', () => {
  it('should return unchanged text when no fallback present', () => {
    const text = 'Hello, this is a normal message';
    assertEquals(stripReplyFallback(text), text);
  });

  it('should strip single line fallback', () => {
    const text = '> <@user:example.com> Original message\n\nMy reply';
    assertEquals(stripReplyFallback(text), 'My reply');
  });

  it('should strip multi-line fallback', () => {
    const text = '> <@user:example.com> First line\n> Second line\n\nMy reply';
    assertEquals(stripReplyFallback(text), 'My reply');
  });

  it('should handle fallback without blank line separator', () => {
    const text = '> <@user:example.com> Original\nMy reply';
    assertEquals(stripReplyFallback(text), 'My reply');
  });

  it('should preserve multiline replies', () => {
    const text = '> <@user:example.com> Original\n\nLine 1\nLine 2\nLine 3';
    assertEquals(stripReplyFallback(text), 'Line 1\nLine 2\nLine 3');
  });

  it('should handle empty reply after fallback', () => {
    const text = '> <@user:example.com> Original\n\n';
    assertEquals(stripReplyFallback(text), '');
  });

  it('should handle only fallback (no reply text)', () => {
    const text = '> <@user:example.com> Original';
    assertEquals(stripReplyFallback(text), '');
  });

  it('should not strip quotes that are part of the message', () => {
    const text = 'My message with a quote:\n> This is a quote I wrote';
    assertEquals(stripReplyFallback(text), text);
  });

  it('should handle real Matrix reply format', () => {
    // Real Matrix reply format includes the sender and message
    const text = '> <@tijs:envs.net> What time is the meeting?\n\nIt starts at 3pm';
    assertEquals(stripReplyFallback(text), 'It starts at 3pm');
  });
});
