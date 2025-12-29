/**
 * Time Utilities for consistent UTC timestamp handling
 *
 * The backend sends timestamps in ISO 8601 UTC format: "2024-01-01T12:00:00.000000Z"
 * This module provides utilities for parsing and formatting these timestamps consistently.
 */

import { formatDistanceToNow, format, parseISO } from "date-fns";

/**
 * Parse an ISO 8601 UTC timestamp string to a Date object.
 *
 * Handles timestamps with or without the 'Z' suffix, microsecond precision,
 * and various ISO 8601 formats from the backend.
 *
 * @param isoString - ISO 8601 timestamp string (e.g., "2024-01-01T12:00:00.000000Z")
 * @returns Date object representing the timestamp
 * @throws Error if the timestamp cannot be parsed
 *
 * @example
 * parseUTCDate("2024-01-01T12:00:00.000000Z") // Date in UTC
 * parseUTCDate("2024-01-01T12:00:00Z") // Also valid
 * parseUTCDate("2024-01-01T12:00:00") // Treated as local time (not recommended)
 */
export function parseUTCDate(isoString: string): Date {
  if (!isoString) {
    throw new Error("Cannot parse empty or undefined timestamp");
  }

  // parseISO from date-fns handles ISO 8601 format including the Z suffix
  // and microsecond precision correctly
  const date = parseISO(isoString);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO 8601 timestamp: ${isoString}`);
  }

  return date;
}

/**
 * Safely parse an ISO 8601 UTC timestamp string to a Date object.
 *
 * Returns null instead of throwing if the timestamp is invalid.
 *
 * @param isoString - ISO 8601 timestamp string or null/undefined
 * @returns Date object or null if parsing fails
 *
 * @example
 * safeParseUTCDate("2024-01-01T12:00:00.000000Z") // Date
 * safeParseUTCDate(null) // null
 * safeParseUTCDate("invalid") // null
 */
export function safeParseUTCDate(
  isoString: string | null | undefined
): Date | null {
  if (!isoString) {
    return null;
  }

  try {
    return parseUTCDate(isoString);
  } catch {
    console.warn(`Failed to parse timestamp: ${isoString}`);
    return null;
  }
}

/**
 * Format a Date object for display in the user's local timezone.
 *
 * Provides a human-readable date and time format appropriate for the locale.
 *
 * @param date - Date object to format
 * @param options - Optional formatting options
 * @returns Formatted date/time string in local timezone
 *
 * @example
 * formatLocalDateTime(new Date()) // "Jan 1, 2024, 12:00 PM"
 * formatLocalDateTime(new Date(), { includeSeconds: true }) // "Jan 1, 2024, 12:00:00 PM"
 */
export function formatLocalDateTime(
  date: Date,
  options?: {
    includeSeconds?: boolean;
    includeYear?: boolean;
    dateOnly?: boolean;
    timeOnly?: boolean;
  }
): string {
  const {
    includeSeconds,
    includeYear = true,
    dateOnly,
    timeOnly,
  } = options ?? {};

  if (dateOnly) {
    return format(date, includeYear ? "MMM d, yyyy" : "MMM d");
  }

  if (timeOnly) {
    return format(date, includeSeconds ? "h:mm:ss a" : "h:mm a");
  }

  const dateFormat = includeYear ? "MMM d, yyyy" : "MMM d";
  const timeFormat = includeSeconds ? "h:mm:ss a" : "h:mm a";

  return format(date, `${dateFormat}, ${timeFormat}`);
}

/**
 * Format a timestamp string for display in local time.
 *
 * Convenience function that combines parsing and formatting.
 *
 * @param isoString - ISO 8601 timestamp string
 * @param options - Optional formatting options
 * @returns Formatted date/time string or fallback if parsing fails
 *
 * @example
 * formatTimestampLocal("2024-01-01T12:00:00.000000Z") // "Jan 1, 2024, 12:00 PM"
 */
export function formatTimestampLocal(
  isoString: string | null | undefined,
  options?: {
    includeSeconds?: boolean;
    includeYear?: boolean;
    dateOnly?: boolean;
    timeOnly?: boolean;
    fallback?: string;
  }
): string {
  const { fallback = "Unknown", ...formatOptions } = options ?? {};

  const date = safeParseUTCDate(isoString);
  if (!date) {
    return fallback;
  }

  return formatLocalDateTime(date, formatOptions);
}

/**
 * Format a date as relative time from now.
 *
 * Produces human-readable strings like "2 hours ago", "in 3 days", etc.
 *
 * @param date - Date object or ISO 8601 string
 * @returns Relative time string with suffix (e.g., "2 hours ago")
 *
 * @example
 * formatRelativeTime(new Date(Date.now() - 3600000)) // "about 1 hour ago"
 * formatRelativeTime("2024-01-01T12:00:00.000000Z") // "3 months ago"
 */
export function formatRelativeTime(date: Date | string): string {
  try {
    const dateObj = typeof date === "string" ? parseISO(date) : date;

    // Check if the date is valid
    if (isNaN(dateObj.getTime())) {
      return "Unknown";
    }

    return formatDistanceToNow(dateObj, { addSuffix: true });
  } catch (error) {
    console.warn("Error formatting relative time:", error);
    return "Unknown";
  }
}

/**
 * Format a timestamp string as relative time.
 *
 * Convenience function with fallback handling for invalid timestamps.
 *
 * @param isoString - ISO 8601 timestamp string or null/undefined
 * @param fallback - String to return if parsing fails
 * @returns Relative time string or fallback
 *
 * @example
 * formatTimestampRelative("2024-01-01T12:00:00.000000Z") // "3 months ago"
 * formatTimestampRelative(null) // "Never"
 */
export function formatTimestampRelative(
  isoString: string | null | undefined,
  fallback = "Never"
): string {
  if (!isoString) {
    return fallback;
  }

  try {
    return formatRelativeTime(isoString);
  } catch {
    return fallback;
  }
}

/**
 * Get the current time as an ISO 8601 UTC string.
 *
 * Useful for creating timestamps that match the backend format.
 *
 * @returns ISO 8601 UTC timestamp string
 *
 * @example
 * nowUTC() // "2024-01-01T12:00:00.000Z"
 */
export function nowUTC(): string {
  return new Date().toISOString();
}

/**
 * Check if a timestamp is in the past.
 *
 * @param isoString - ISO 8601 timestamp string
 * @returns true if the timestamp is before now
 *
 * @example
 * isPast("2024-01-01T12:00:00.000000Z") // true (if current date is after)
 */
export function isPast(isoString: string | null | undefined): boolean {
  if (!isoString) {
    return false;
  }

  const date = safeParseUTCDate(isoString);
  if (!date) {
    return false;
  }

  return date.getTime() < Date.now();
}

/**
 * Check if a timestamp is in the future.
 *
 * @param isoString - ISO 8601 timestamp string
 * @returns true if the timestamp is after now
 *
 * @example
 * isFuture("2030-01-01T12:00:00.000000Z") // true
 */
export function isFuture(isoString: string | null | undefined): boolean {
  if (!isoString) {
    return false;
  }

  const date = safeParseUTCDate(isoString);
  if (!date) {
    return false;
  }

  return date.getTime() > Date.now();
}

/**
 * Calculate the duration in milliseconds between two timestamps.
 *
 * @param startIso - Start timestamp (ISO 8601 string or Date)
 * @param endIso - End timestamp (ISO 8601 string or Date)
 * @returns Duration in milliseconds, or 0 if parsing fails
 *
 * @example
 * getDurationMs("2024-01-01T12:00:00Z", "2024-01-01T13:00:00Z") // 3600000
 */
export function getDurationMs(
  startIso: string | Date,
  endIso: string | Date
): number {
  try {
    const startDate =
      typeof startIso === "string" ? parseISO(startIso) : startIso;
    const endDate = typeof endIso === "string" ? parseISO(endIso) : endIso;

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return 0;
    }

    return Math.abs(endDate.getTime() - startDate.getTime());
  } catch {
    return 0;
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * formatDurationMs(3600000) // "1h"
 * formatDurationMs(90000) // "1m 30s"
 * formatDurationMs(500) // "500ms"
 */
export function formatDurationMs(ms: number): string {
  if (ms < 0) return "0ms";
  if (ms === 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  return `${seconds}s`;
}
