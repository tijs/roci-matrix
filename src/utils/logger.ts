/**
 * Logging utilities with timestamps
 */

/**
 * Get current timestamp in ISO format
 */
function timestamp(): string {
  return new Date().toISOString();
}

export function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

export function error(message: string, err?: unknown): void {
  if (err) {
    console.error(`${timestamp()} ❌ ${message}:`, err);
  } else {
    console.error(`${timestamp()} ❌ ${message}`);
  }
}

export function warn(message: string): void {
  console.warn(`${timestamp()} ⚠️  ${message}`);
}

export function info(message: string): void {
  console.log(`${timestamp()} ℹ️  ${message}`);
}

export function success(message: string): void {
  console.log(`${timestamp()} ✅ ${message}`);
}

export function debug(message: string): void {
  // Use debugPrint() which gets removed in production
  debugPrint(message);
}

/**
 * Debug print - removed in production builds
 */
function debugPrint(message: string): void {
  console.log(`${timestamp()} 🐛 ${message}`);
}
