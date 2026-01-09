import { assertEquals } from '@std/assert';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { AggregationState, MessageAggregator } from '../../src/utils/message-aggregator.ts';
import type { MatrixMessageEvent } from '../../src/types.ts';

/**
 * Create a mock MatrixMessageEvent for testing
 */
function createMockEvent(
  overrides: Partial<MatrixMessageEvent> = {},
): MatrixMessageEvent {
  return {
    event_id: `$event_${Math.random().toString(36).slice(2)}`,
    sender: '@user:example.com',
    origin_server_ts: Date.now(),
    room_id: '!room:example.com',
    content: {
      msgtype: 'm.text',
      body: 'Test message',
    },
    ...overrides,
  };
}

/**
 * Helper to wait for a specific duration
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MessageAggregator', () => {
  let aggregator: MessageAggregator;
  const AGGREGATION_WINDOW = 100; // Short window for faster tests
  const roomId = '!testroom:example.com';

  beforeEach(() => {
    aggregator = new MessageAggregator(AGGREGATION_WINDOW);
  });

  afterEach(() => {
    aggregator.cleanup();
  });

  describe('State Machine', () => {
    it('should start in WAITING_FOR_MEDIA state', async () => {
      const event = createMockEvent();

      // Start handling text (don't await - we want to check state mid-flight)
      const promise = aggregator.handleText(
        roomId,
        event,
        () => Promise.resolve(),
      );

      // Give it a moment to set up
      await delay(10);

      assertEquals(
        aggregator.getState(roomId, event.sender),
        AggregationState.WAITING_FOR_MEDIA,
      );

      // Clean up
      aggregator.cleanup();
      await promise.catch(() => {}); // Ignore any errors from cleanup
    });

    it('should transition to PROCESSED_AS_TEXT on timeout', async () => {
      const event = createMockEvent();
      let processed = false;

      await aggregator.handleText(roomId, event, () => {
        processed = true;
        return Promise.resolve();
      });

      assertEquals(processed, true);
      assertEquals(aggregator.getPendingCount(), 0);
    });

    it('should transition to COMBINED_WITH_MEDIA when image arrives', async () => {
      const textEvent = createMockEvent({
        content: { msgtype: 'm.text', body: 'Check this image' },
      });
      const imageEvent = createMockEvent({
        event_id: '$image_event',
        content: { msgtype: 'm.image', body: 'image.png', url: 'mxc://...' },
      });

      let textProcessed = false;
      let imageProcessed = false;
      let combinedText: string | undefined;

      // Start text handling (non-blocking)
      const textPromise = aggregator.handleText(roomId, textEvent, () => {
        textProcessed = true;
        return Promise.resolve();
      });

      // Image arrives before timeout
      await delay(20);
      await aggregator.handleImage(roomId, imageEvent, (_room, _img, text) => {
        imageProcessed = true;
        combinedText = text;
        return Promise.resolve();
      });

      // Wait for text handler to complete
      await textPromise;

      assertEquals(
        textProcessed,
        false,
        'Text should NOT be processed separately',
      );
      assertEquals(imageProcessed, true, 'Image should be processed');
      assertEquals(
        combinedText,
        'Check this image',
        'Text should be combined with image',
      );
      assertEquals(aggregator.getPendingCount(), 0);
    });
  });

  describe('Race Condition: Image arrives before timeout', () => {
    it('should combine text with image when image arrives first', async () => {
      const textEvent = createMockEvent({
        content: { msgtype: 'm.text', body: 'Caption text' },
      });
      const imageEvent = createMockEvent({
        event_id: '$img',
        content: { msgtype: 'm.image', body: 'photo.jpg' },
      });

      const calls: string[] = [];

      const textPromise = aggregator.handleText(roomId, textEvent, () => {
        calls.push('text-only');
        return Promise.resolve();
      });

      await delay(20);

      await aggregator.handleImage(roomId, imageEvent, (_room, _img, text) => {
        calls.push(`image-with-text:${text}`);
        return Promise.resolve();
      });

      await textPromise;

      assertEquals(calls, ['image-with-text:Caption text']);
    });
  });

  describe('Race Condition: Timeout fires before image', () => {
    it('should process text alone when timeout fires first', async () => {
      const textEvent = createMockEvent({
        content: { msgtype: 'm.text', body: 'Just text' },
      });
      const imageEvent = createMockEvent({
        event_id: '$late_img',
        content: { msgtype: 'm.image', body: 'late.jpg' },
      });

      const calls: string[] = [];

      // Wait for text to timeout
      await aggregator.handleText(roomId, textEvent, () => {
        calls.push('text-only');
        return Promise.resolve();
      });

      // Image arrives after timeout
      await aggregator.handleImage(roomId, imageEvent, (_room, _img, text) => {
        calls.push(text ? `image-with-text:${text}` : 'image-alone');
        return Promise.resolve();
      });

      assertEquals(calls, ['text-only', 'image-alone']);
    });
  });

  describe('Race Condition: Rapid text messages', () => {
    it('should handle rapid text messages from same user', async () => {
      const event1 = createMockEvent({
        event_id: '$msg1',
        content: { msgtype: 'm.text', body: 'First message' },
      });
      const event2 = createMockEvent({
        event_id: '$msg2',
        content: { msgtype: 'm.text', body: 'Second message' },
      });

      const processed: string[] = [];

      // Start first text (non-blocking)
      const promise1 = aggregator.handleText(roomId, event1, (_room, event) => {
        processed.push(event.content.body);
        return Promise.resolve();
      });

      await delay(20);

      // Second text arrives before first times out
      const promise2 = aggregator.handleText(roomId, event2, (_room, event) => {
        processed.push(event.content.body);
        return Promise.resolve();
      });

      // Wait for both
      await Promise.all([promise1, promise2]);

      // First message should be processed immediately when second arrives
      // Second message should be processed after timeout
      assertEquals(processed.length, 2);
      assertEquals(processed.includes('First message'), true);
      assertEquals(processed.includes('Second message'), true);
    });
  });

  describe('File handling', () => {
    it('should combine text with file', async () => {
      const textEvent = createMockEvent({
        content: { msgtype: 'm.text', body: 'Document attached' },
      });
      const fileEvent = createMockEvent({
        event_id: '$file',
        content: { msgtype: 'm.file', body: 'document.pdf' },
      });

      let combinedText: string | undefined;

      const textPromise = aggregator.handleText(
        roomId,
        textEvent,
        () => Promise.resolve(),
      );

      await delay(20);

      await aggregator.handleFile(roomId, fileEvent, (_room, _file, text) => {
        combinedText = text;
        return Promise.resolve();
      });

      await textPromise;

      assertEquals(combinedText, 'Document attached');
    });
  });

  describe('Multiple users', () => {
    it('should track pending texts separately per user', async () => {
      const user1Event = createMockEvent({
        event_id: '$user1',
        sender: '@user1:example.com',
        content: { msgtype: 'm.text', body: 'User 1 text' },
      });
      const user2Event = createMockEvent({
        event_id: '$user2',
        sender: '@user2:example.com',
        content: { msgtype: 'm.text', body: 'User 2 text' },
      });
      const user1Image = createMockEvent({
        event_id: '$user1_img',
        sender: '@user1:example.com',
        content: { msgtype: 'm.image', body: 'img1.jpg' },
      });

      const calls: string[] = [];

      // Both users send text
      const promise1 = aggregator.handleText(roomId, user1Event, () => {
        calls.push('user1-text-only');
        return Promise.resolve();
      });
      const promise2 = aggregator.handleText(roomId, user2Event, () => {
        calls.push('user2-text-only');
        return Promise.resolve();
      });

      await delay(20);

      // Only user1 sends image
      await aggregator.handleImage(roomId, user1Image, (_room, _img, text) => {
        calls.push(`user1-image:${text}`);
        return Promise.resolve();
      });

      await Promise.all([promise1, promise2]);

      // User1's text combined with image, user2's text processed alone
      assertEquals(calls.includes('user1-image:User 1 text'), true);
      assertEquals(calls.includes('user2-text-only'), true);
      assertEquals(calls.includes('user1-text-only'), false);
    });
  });

  describe('Claim methods', () => {
    it('claimForMedia should fail if no pending entry', () => {
      const result = aggregator.claimForMedia('nonexistent:key');
      assertEquals(result.success, false);
    });

    it('claimForMedia should fail if already claimed', async () => {
      const event = createMockEvent();

      const promise = aggregator.handleText(
        roomId,
        event,
        () => Promise.resolve(),
      );

      await delay(10);

      // First claim succeeds
      const key = `${roomId}:${event.sender}`;
      const result1 = aggregator.claimForMedia(key);
      assertEquals(result1.success, true);

      // Second claim fails (entry deleted)
      const result2 = aggregator.claimForMedia(key);
      assertEquals(result2.success, false);

      await promise;
    });
  });

  describe('Cleanup', () => {
    it('should clear all pending entries on cleanup', async () => {
      const event = createMockEvent();

      // Start handling (don't await)
      const promise = aggregator.handleText(
        roomId,
        event,
        () => Promise.resolve(),
      );

      await delay(10);
      assertEquals(aggregator.getPendingCount(), 1);

      aggregator.cleanup();
      assertEquals(aggregator.getPendingCount(), 0);

      // Let promise resolve
      await promise.catch(() => {});
    });
  });
});
