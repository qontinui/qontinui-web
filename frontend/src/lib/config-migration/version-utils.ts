/**
 * Version Utilities for Config Migration
 *
 * Semantic versioning comparison and validation utilities
 */

/**
 * Parse semantic version string into components
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Check if version string is valid semantic version (X.Y.Z)
 */
export function isValidVersion(version: string): boolean {
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
