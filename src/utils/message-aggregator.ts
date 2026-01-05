/**
 * Message Aggregator
 * Combines text + image messages sent in quick succession into a single request.
 *
 * Problem: When Element sends text with an image attachment, it sends TWO events:
 * 1. m.text with the caption
 * 2. m.image with the file
 *
 * Without aggregation, the text gets processed first and the agent responds
 * "I don't have an image" before the image arrives.
 *
 * Solution: Buffer text messages briefly, combine with image if one follows quickly.
 */

import type { MatrixMessageEvent } from '../types.ts';
import * as logger from './logger.ts';

/**
 * Pending text message waiting for potential image
 */
interface PendingText {
  roomId: string;
  event: MatrixMessageEvent;
  timeoutId: number;
  resolve: () => void;
}

/**
 * Combined message with text and optional image
 */
export interface AggregatedMessage {
  roomId: string;
  textEvent?: MatrixMessageEvent;
  imageEvent?: MatrixMessageEvent;
  fileEvent?: MatrixMessageEvent;
}

/**
 * Callback types for message handling
 */
export type TextOnlyHandler = (roomId: string, event: MatrixMessageEvent) => Promise<void>;
export type ImageHandler = (
  roomId: string,
  imageEvent: MatrixMessageEvent,
  textContent?: string,
) => Promise<void>;
export type FileHandler = (
  roomId: string,
  fileEvent: MatrixMessageEvent,
  textContent?: string,
) => Promise<void>;

/**
 * Message aggregator that combines text + media messages
 */
export class MessageAggregator {
  // Pending text messages keyed by "roomId:senderId"
  private pendingTexts: Map<string, PendingText> = new Map();

  // How long to wait for an image after receiving text (ms)
  private readonly aggregationWindowMs: number;

  constructor(aggregationWindowMs = 2000) {
    this.aggregationWindowMs = aggregationWindowMs;
  }

  /**
   * Get key for pending message lookup
   */
  private getKey(roomId: string, senderId: string): string {
    return `${roomId}:${senderId}`;
  }

  /**
   * Handle incoming text message
   * Buffers it briefly waiting for potential image follow-up
   */
  async handleText(
    roomId: string,
    event: MatrixMessageEvent,
    onTextOnly: TextOnlyHandler,
  ): Promise<void> {
    const key = this.getKey(roomId, event.sender);

    // Clear any existing pending text for this user/room
    const existing = this.pendingTexts.get(key);
    if (existing) {
      clearTimeout(existing.timeoutId);
      // Process the old text immediately since new text arrived
      logger.debug(`New text arrived, processing previous text immediately`);
      existing.resolve();
    }

    // Create a promise that resolves when we should process this text
    await new Promise<void>((resolve) => {
      const timeoutId = setTimeout(() => {
        // Timeout expired, no image arrived - process as text-only
        logger.debug(`Aggregation timeout for ${key}, processing text-only`);
        // NOTE: Don't delete here - the check after resolve() needs to find it
        // to know we should call onTextOnly. handleImage deletes it if image arrives.
        resolve();
      }, this.aggregationWindowMs);

      // Store pending text
      this.pendingTexts.set(key, {
        roomId,
        event,
        timeoutId: timeoutId as unknown as number,
        resolve,
      });

      logger.debug(
        `Buffering text message from ${event.sender}, waiting ${this.aggregationWindowMs}ms for image`,
      );
    });

    // If we get here and still have the pending text, process it
    // (The pending text might have been consumed by handleImage already)
    const stillPending = this.pendingTexts.get(key);
    if (stillPending && stillPending.event.event_id === event.event_id) {
      this.pendingTexts.delete(key);
      await onTextOnly(roomId, event);
    }
  }

  /**
   * Handle incoming image message
   * Checks for pending text to combine with
   */
  async handleImage(
    roomId: string,
    event: MatrixMessageEvent,
    onImage: ImageHandler,
  ): Promise<void> {
    const key = this.getKey(roomId, event.sender);

    // Check for pending text from same user
    const pendingText = this.pendingTexts.get(key);

    if (pendingText) {
      // Found pending text - combine them!
      clearTimeout(pendingText.timeoutId);
      this.pendingTexts.delete(key);

      const textContent = pendingText.event.content.body;
      logger.info(`Combining text "${textContent.slice(0, 50)}..." with image`);

      // Resolve the pending text's promise (it won't process since we deleted it)
      pendingText.resolve();

      // Process combined message
      await onImage(roomId, event, textContent);
    } else {
      // No pending text - process image alone
      await onImage(roomId, event);
    }
  }

  /**
   * Handle incoming file message
   * Checks for pending text to combine with
   */
  async handleFile(
    roomId: string,
    event: MatrixMessageEvent,
    onFile: FileHandler,
  ): Promise<void> {
    const key = this.getKey(roomId, event.sender);

    // Check for pending text from same user
    const pendingText = this.pendingTexts.get(key);

    if (pendingText) {
      // Found pending text - combine them!
      clearTimeout(pendingText.timeoutId);
      this.pendingTexts.delete(key);

      const textContent = pendingText.event.content.body;
      logger.info(`Combining text "${textContent.slice(0, 50)}..." with file`);

      // Resolve the pending text's promise
      pendingText.resolve();

      // Process combined message
      await onFile(roomId, event, textContent);
    } else {
      // No pending text - process file alone
      await onFile(roomId, event);
    }
  }

  /**
   * Clean up any pending timeouts
   */
  cleanup(): void {
    for (const pending of this.pendingTexts.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingTexts.clear();
  }
}
