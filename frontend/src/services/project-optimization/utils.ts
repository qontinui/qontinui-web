/**
 * Utility functions shared across optimization modules
 */

/**
 * Calculate string similarity using Levenshtein distance
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    if (matrix[0]) {
      matrix[0][j] = j;
    }
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const prevRow = matrix[i - 1];
      const currRow = matrix[i];
      const prevRowPrevCol = prevRow?.[j - 1];

      if (currRow && prevRow && prevRowPrevCol !== undefined) {
        currRow[j] = Math.min(
          prevRow[j]! + 1,
          currRow[j - 1] + 1,
          prevRowPrevCol + cost
        );
      }
    }
  }

  const distance = matrix[len1]?.[len2] ?? 0;
  const maxLen = Math.max(len1, len2);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
