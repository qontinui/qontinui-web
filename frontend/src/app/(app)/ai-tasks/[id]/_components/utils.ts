export const SCREENSHOT_PROXY_BASE = "/api/v1/screenshots";
export const TEXT_PREVIEW_LIMIT = 500;

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function screenshotUrl(path: string): string {
  const clean = path
    .replace(/^\.?[/\\]?dev-logs[/\\]/, "")
    .replace(/^\.dev-logs[/\\]/, "");
  return `${SCREENSHOT_PROXY_BASE}/${clean}`;
}
