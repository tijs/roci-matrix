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
 *
 * Implementation: Uses explicit state machine to avoid race conditions between
 * timeout handler and media handlers.
 */

import type { MatrixMessageEvent } from '../types.ts';
import * as logger from './logger.ts';

/**
 * Aggregation state machine states
 */
export enum AggregationState {
  /** Waiting for potential image/file to arrive */
  WAITING_FOR_MEDIA = 'WAITING_FOR_MEDIA',
  /** Image/file arrived and claimed the text */
  COMBINED_WITH_MEDIA = 'COMBINED_WITH_MEDIA',
  /** Timeout fired and claimed the text for text-only processing */
  PROCESSED_AS_TEXT = 'PROCESSED_AS_TEXT',
}

/**
 * Pending text message with state tracking
 */
interface PendingEntry {
  state: AggregationState;
  roomId: string;
  event: MatrixMessageEvent;
  timeoutId: number;
  /** Resolves the handleText promise when state transitions */
  resolve: () => void;
  /** Callback to process as text-only (stored for supersession handling) */
  onTextOnly: TextOnlyHandler;
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
 * Result of an atomic claim operation
 */
export interface ClaimResult {
  success: boolean;
  event?: MatrixMessageEvent;
  textContent?: string;
}

/**
 * Callback types for message handling
 */
export type TextOnlyHandler = (
  roomId: string,
  event: MatrixMessageEvent,
) => Promise<void>;
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
 * Message aggregator using explicit state machine
 *
 * State transitions:
 * - WAITING_FOR_MEDIA → COMBINED_WITH_MEDIA (media arrived first)
 * - WAITING_FOR_MEDIA → PROCESSED_AS_TEXT (timeout fired first)
 *
 * Atomic claim methods ensure only one handler can claim a pending entry.
 */
export class MessageAggregator {
  // Pending text messages keyed by "roomId:senderId"
  private pending: Map<string, PendingEntry> = new Map();

  // How long to wait for media after receiving text (ms)
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
   * Atomically claim pending text for media combination.
   * Returns the text event only if state was WAITING_FOR_MEDIA.
   * Transitions state to COMBINED_WITH_MEDIA if successful.
   */
  claimForMedia(key: string): ClaimResult {
    const entry = this.pending.get(key);

    if (!entry) {
      return { success: false };
    }

    if (entry.state !== AggregationState.WAITING_FOR_MEDIA) {
      // Already claimed by timeout or another handler
      logger.debug(`Cannot claim ${key} for media: state is ${entry.state}`);
      return { success: false };
    }

    // Atomically transition state
    entry.state = AggregationState.COMBINED_WITH_MEDIA;
    clearTimeout(entry.timeoutId);

    const textContent = entry.event.content.body;
    const event = entry.event;

    // Clean up and resolve the waiting promise
    this.pending.delete(key);
    entry.resolve();

    logger.debug(`Claimed ${key} for media combination`);
    return { success: true, event, textContent };
  }

  /**
   * Atomically claim pending text for text-only processing.
   * Returns the text event only if state was WAITING_FOR_MEDIA.
   * Transitions state to PROCESSED_AS_TEXT if successful.
   */
  claimForTimeout(key: string, eventId: string): ClaimResult {
    const entry = this.pending.get(key);

    if (!entry) {
      return { success: false };
    }

    // Verify this is the same event (not a newer text that replaced it)
    if (entry.event.event_id !== eventId) {
      logger.debug(
        `Event ID mismatch for ${key}: expected ${eventId}, got ${entry.event.event_id}`,
      );
      return { success: false };
    }

    if (entry.state !== AggregationState.WAITING_FOR_MEDIA) {
      // Already claimed by media handler
      logger.debug(`Cannot claim ${key} for timeout: state is ${entry.state}`);
      return { success: false };
    }

    // Atomically transition state
    entry.state = AggregationState.PROCESSED_AS_TEXT;

    const event = entry.event;

    // Clean up (don't resolve - the timeout handler will continue)
    this.pending.delete(key);

    logger.debug(`Claimed ${key} for text-only processing`);
    return { success: true, event };
  }

  /**
   * Handle incoming text message
   * Buffers it briefly waiting for potential media follow-up
   */
  async handleText(
    roomId: string,
    event: MatrixMessageEvent,
    onTextOnly: TextOnlyHandler,
  ): Promise<void> {
    const key = this.getKey(roomId, event.sender);

    // Clear any existing pending text for this user/room
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timeoutId);
      // Process the old text immediately since new text arrived
      logger.debug(`New text arrived, processing previous text immediately`);
      existing.state = AggregationState.PROCESSED_AS_TEXT;
      this.pending.delete(key);
      // Signal that media won't claim it (resolve with false so original handler doesn't process)
      existing.resolve();
      // Fire-and-forget: process old text in background while handling new text
      // Failures logged but non-critical (superseded text is already stale)
      existing.onTextOnly(existing.roomId, existing.event).catch((err) => {
        logger.error(`Error processing superseded text: ${err}`);
      });
    }

    // Create a promise that resolves with whether to process
    const shouldProcessAsText = await new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => {
        // Try to claim for text-only processing
        const result = this.claimForTimeout(key, event.event_id);
        resolve(result.success);
      }, this.aggregationWindowMs);

      // Store pending entry in WAITING state
      this.pending.set(key, {
        state: AggregationState.WAITING_FOR_MEDIA,
        roomId,
        event,
        timeoutId: timeoutId as unknown as number,
        resolve: () => resolve(false), // Media claimed it, don't process as text
        onTextOnly, // Store callback for supersession handling
      });

      logger.debug(
        `Buffering text message from ${event.sender}, waiting ${this.aggregationWindowMs}ms for media`,
      );
    });

    // Only process as text if we successfully claimed it
    if (shouldProcessAsText) {
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

    // Try to claim pending text
    const claim = this.claimForMedia(key);

    if (claim.success && claim.textContent) {
      logger.info(
        `Combining text "${claim.textContent.slice(0, 50)}..." with image`,
      );
      await onImage(roomId, event, claim.textContent);
    } else {
      // No pending text or couldn't claim - process image alone
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

    // Try to claim pending text
    const claim = this.claimForMedia(key);

    if (claim.success && claim.textContent) {
      logger.info(
        `Combining text "${claim.textContent.slice(0, 50)}..." with file`,
      );
      await onFile(roomId, event, claim.textContent);
    } else {
      // No pending text or couldn't claim - process file alone
      await onFile(roomId, event);
    }
  }

  /**
   * Get current state for a key (for testing)
   */
  getState(roomId: string, senderId: string): AggregationState | undefined {
    const key = this.getKey(roomId, senderId);
    return this.pending.get(key)?.state;
  }

  /**
   * Get pending count (for testing)
   */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * Clean up any pending timeouts and resolve pending promises
   */
  cleanup(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeoutId);
      // Resolve the promise so handleText() doesn't hang
      entry.resolve();
    }
    this.pending.clear();
  }
}
