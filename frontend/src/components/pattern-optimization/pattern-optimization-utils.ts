import type { PatternQuality } from "@/types/pattern-optimization";

/**
 * Returns Tailwind CSS classes for a pattern quality rating badge.
 */
export const getQualityColor = (rating: PatternQuality["rating"]): string => {
  switch (rating) {
    case "excellent":
      return "text-green-600 bg-green-50 border-green-200";
    case "good":
      return "text-blue-600 bg-blue-50 border-blue-200";
    case "fair":
      return "text-yellow-600 bg-yellow-50 border-yellow-200";
    case "poor":
      return "text-red-600 bg-red-50 border-red-200";
  }
};

/**
 * Converts a data URL (or any fetchable URL) to a File object.
 */
export const urlToFile = async (
  url: string,
  filename: string
): Promise<File> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
};
