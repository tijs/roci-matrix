/**
 * Media validation utilities for image MIME types
 */

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
