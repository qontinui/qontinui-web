import { formatDistanceToNow, formatDistance, parseISO } from 'date-fns';

/**
 * Format seconds into human-readable duration
 * Examples: "2h 34m", "45m 12s", "3d 5h", "12s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return '0s';
  if (seconds === 0) return '0s';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    // Don't show minutes/seconds if we have days
    return parts.join(' ');
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    // Don't show seconds if we have hours
    return parts.join(' ');
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
    return parts.join(' ');
  }

  return `${secs}s`;
}

/**
 * Format a date string or Date object into relative time
 * Examples: "2 minutes ago", "3 hours ago", "5 days ago"
 */
export function formatRelativeTime(date: string | Date): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  } catch (error) {
    console.error('Error formatting relative time:', error);
    return 'Unknown';
  }
}

/**
 * Format the distance between two dates
 * Examples: "2 hours", "3 days", "45 minutes"
 */
export function formatDistanceBetween(start: string | Date, end: string | Date): string {
  try {
    const startDate = typeof start === 'string' ? parseISO(start) : start;
    const endDate = typeof end === 'string' ? parseISO(end) : end;
    return formatDistance(startDate, endDate);
  } catch (error) {
    console.error('Error formatting distance:', error);
    return 'Unknown';
  }
}

/**
 * Check if a date is expired (in the past)
 */
export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false; // No expiration = never expires
  try {
    const expiryDate = parseISO(expiresAt);
    return expiryDate < new Date();
  } catch (error) {
    console.error('Error checking expiration:', error);
    return false;
  }
}

/**
 * Check if a date is expiring soon (within the next 7 days)
 */
export function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  try {
    const expiryDate = parseISO(expiresAt);
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const now = new Date();
    return expiryDate > now && expiryDate <= sevenDaysFromNow;
  } catch (error) {
    console.error('Error checking if expiring soon:', error);
    return false;
  }
}
