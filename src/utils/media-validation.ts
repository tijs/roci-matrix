/**
 * Media validation utilities for image and file MIME types
 */

/**
 * Map of MIME types to file extensions for document types
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'text/html': 'html',
  'application/xhtml+xml': 'xhtml',
  'application/epub+zip': 'epub',
  'application/json': 'json',
  'text/csv': 'csv',
};

/**
 * Get file extension from MIME type
 * Falls back to extracting from filename if MIME type not recognized
 * @param mimeType - MIME type string
 * @param filename - Original filename (fallback)
 * @returns File extension without the dot
 */
export function getExtensionFromMimeType(
  mimeType: string,
  filename: string,
): string {
  const normalized = mimeType.toLowerCase().trim();

  // Check direct mapping
  if (MIME_TO_EXTENSION[normalized]) {
    return MIME_TO_EXTENSION[normalized];
  }

  // For generic types, try to extract from filename
  const parts = filename.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toLowerCase();
    if (ext && ext.length <= 5) {
      // Reasonable extension length
      return ext;
    }
  }

  // Default to pdf for documents (most common case)
  return 'pdf';
}

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type SupportedImageType = typeof SUPPORTED_IMAGE_TYPES[number];

/**
 * Normalize and validate image MIME type
 * Handles common variations (e.g., image/jpg -> image/jpeg)
 * @param mimeType - Raw MIME type from Matrix
 * @returns Normalized MIME type
 * @throws Error if MIME type is not supported by Claude API
 */
export function normalizeImageMimeType(mimeType: string): SupportedImageType {
  const normalized = mimeType.toLowerCase().trim();

  // Handle common variations
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }

  // Validate against Claude's supported types
  if (SUPPORTED_IMAGE_TYPES.includes(normalized as SupportedImageType)) {
    return normalized as SupportedImageType;
  }

  throw new Error(
    `Unsupported image type: ${mimeType}. Supported formats: ${SUPPORTED_IMAGE_TYPES.join(', ')}`,
  );
}
