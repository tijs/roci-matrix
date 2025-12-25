/**
 * Logging utilities
 */

export function log(message: string): void {
  console.log(message);
}

export function error(message: string, err?: unknown): void {
  if (err) {
    console.error(`❌ ${message}:`, err);
  } else {
    console.error(`❌ ${message}`);
  }
}

export function warn(message: string): void {
  console.warn(`⚠️  ${message}`);
}

export function info(message: string): void {
  console.log(`ℹ️  ${message}`);
}

export function success(message: string): void {
  console.log(`✅ ${message}`);
}

export function debug(message: string): void {
  // Use debugPrint() which gets removed in production
  debugPrint(message);
}

/**
 * Debug print - removed in production builds
 */
function debugPrint(message: string): void {
  console.log(`🐛 ${message}`);
}
