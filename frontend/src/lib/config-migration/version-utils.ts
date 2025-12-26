/**
 * Version Utilities for Config Migration
 *
 * Semantic versioning comparison and validation utilities
 */

/**
 * Special version strings for legacy format migrations
 */
export const LEGACY_RAG_VERSION = "0.0.0-legacy-rag";

/**
 * Parse semantic version string into components
 */
export function parseVersion(
  version: string
): { major: number; minor: number; patch: number } | null {
  // Handle special legacy version
  if (version === LEGACY_RAG_VERSION) {
    return { major: 0, minor: 0, patch: 0 };
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;

  return {
    major: parseInt(match[1] || "0", 10),
    minor: parseInt(match[2] || "0", 10),
    patch: parseInt(match[3] || "0", 10),
  };
}

/**
 * Check if version string is valid semantic version (X.Y.Z) or a known special version
 */
export function isValidVersion(version: string): boolean {
  // Accept the special legacy RAG version
  if (version === LEGACY_RAG_VERSION) {
    return true;
  }
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Compare two semantic version strings
 *
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (!parsedA || !parsedB) {
    throw new Error(`Invalid version format: ${!parsedA ? a : b}`);
  }

  // Compare major version
  if (parsedA.major !== parsedB.major) {
    return parsedA.major - parsedB.major;
  }

  // Compare minor version
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor - parsedB.minor;
  }

  // Compare patch version
  return parsedA.patch - parsedB.patch;
}

/**
 * Check if version A is less than version B
 */
export function isVersionLessThan(a: string, b: string): boolean {
  return compareVersions(a, b) < 0;
}

/**
 * Check if version A is greater than version B
 */
export function isVersionGreaterThan(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/**
 * Check if version A equals version B
 */
export function isVersionEqual(a: string, b: string): boolean {
  return compareVersions(a, b) === 0;
}
