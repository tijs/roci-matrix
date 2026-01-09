/**
 * Unit tests for media-validation utilities
 */

import { assertEquals } from '@std/assert';
import {
  getExtensionFromMimeType,
  normalizeImageMimeType,
} from '../../src/utils/media-validation.ts';

Deno.test('getExtensionFromMimeType - PDF', () => {
  assertEquals(getExtensionFromMimeType('application/pdf', 'doc.pdf'), 'pdf');
  assertEquals(getExtensionFromMimeType('application/pdf', 'document'), 'pdf');
});

Deno.test('getExtensionFromMimeType - DOCX', () => {
  assertEquals(
    getExtensionFromMimeType(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'file.docx',
    ),
    'docx',
  );
  assertEquals(
    getExtensionFromMimeType(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'report',
    ),
    'docx',
  );
});

Deno.test('getExtensionFromMimeType - plain text', () => {
  assertEquals(getExtensionFromMimeType('text/plain', 'notes.txt'), 'txt');
  assertEquals(getExtensionFromMimeType('text/plain', 'notes'), 'txt');
});

Deno.test('getExtensionFromMimeType - markdown', () => {
  assertEquals(getExtensionFromMimeType('text/markdown', 'readme.md'), 'md');
  assertEquals(getExtensionFromMimeType('text/markdown', 'README'), 'md');
});

Deno.test('getExtensionFromMimeType - falls back to filename extension', () => {
  // Unknown MIME type, should use filename extension
  assertEquals(
    getExtensionFromMimeType('application/octet-stream', 'file.xyz'),
    'xyz',
  );
});

Deno.test('getExtensionFromMimeType - defaults to pdf for unknown', () => {
  // Unknown MIME type and no valid extension
  assertEquals(
    getExtensionFromMimeType('application/octet-stream', 'document'),
    'pdf',
  );
});

Deno.test('getExtensionFromMimeType - ignores long extensions', () => {
  // Extension too long (>5 chars), should default
  assertEquals(
    getExtensionFromMimeType('application/octet-stream', 'file.verylongext'),
    'pdf',
  );
});

Deno.test('normalizeImageMimeType - jpeg variations', () => {
  assertEquals(normalizeImageMimeType('image/jpeg'), 'image/jpeg');
  assertEquals(normalizeImageMimeType('image/jpg'), 'image/jpeg');
  assertEquals(normalizeImageMimeType('IMAGE/JPEG'), 'image/jpeg');
});

Deno.test('normalizeImageMimeType - other formats', () => {
  assertEquals(normalizeImageMimeType('image/png'), 'image/png');
  assertEquals(normalizeImageMimeType('image/gif'), 'image/gif');
  assertEquals(normalizeImageMimeType('image/webp'), 'image/webp');
});
