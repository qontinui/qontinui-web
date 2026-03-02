export const COMPLEXITY_COLORS = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#f97316",
  "very-high": "#ef4444",
};

export const CHART_COLORS = {
  primary: "#3b82f6",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function getComplexityColor(rating: string): string {
  return (
    COMPLEXITY_COLORS[rating as keyof typeof COMPLEXITY_COLORS] ||
    COMPLEXITY_COLORS.low
  );
}
