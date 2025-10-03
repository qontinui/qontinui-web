/**
 * Image utility functions
 */

/**
 * Calculate SHA-256 hash of an image file
 */
export async function calculateImageHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Calculate hashes for multiple image files
 */
export async function calculateImageHashes(files: File[]): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const file of files) {
    try {
      const hash = await calculateImageHash(file);
      hashes.set(file.name, hash);
    } catch (error) {
      console.error(`Failed to calculate hash for ${file.name}:`, error);
    }
  }

  return hashes;
}

/**
 * Check if an image hash exists in a list of existing hashes
 */
export function isDuplicateImage(hash: string, existingHashes: string[]): boolean {
  return existingHashes.includes(hash);
}

/**
 * Filter out duplicate images based on hashes
 */
export async function filterDuplicateImages(
  files: File[],
  existingHashes: string[]
): Promise<{ unique: File[], duplicates: File[] }> {
  const unique: File[] = [];
  const duplicates: File[] = [];

  for (const file of files) {
    try {
      const hash = await calculateImageHash(file);
      if (isDuplicateImage(hash, existingHashes)) {
        duplicates.push(file);
      } else {
        unique.push(file);
      }
    } catch (error) {
      console.error(`Failed to process ${file.name}:`, error);
      unique.push(file); // Include files that couldn't be hashed
    }
  }

  return { unique, duplicates };
}
