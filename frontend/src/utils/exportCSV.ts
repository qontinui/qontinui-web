import type { RunnerSession } from "@/types/runner";
import { formatDuration } from "./formatDuration";

/**
 * Export runner-session history as a CSV file.
 */
export function exportRunnerSessionsCSV(
  sessions: RunnerSession[],
  filename: string = "runner-sessions.csv"
): void {
  if (sessions.length === 0) {
    console.warn("No sessions to export");
    return;
  }

  // Define CSV headers
  const headers = [
    "Runner Name",
    "Runner ID",
    "Connected At",
    "Disconnected At",
    "Duration",
    "IP Address",
    "User Agent",
    "Session ID",
  ];

  // Convert sessions to CSV rows
  const rows = sessions.map((s) => {
    const duration = s.duration_seconds
      ? formatDuration(s.duration_seconds)
      : s.disconnected_at
        ? "Calculating..."
        : "Active";

    return [
      escapeCSVField(s.runner_name || "Unknown"),
      escapeCSVField(s.runner_id),
      escapeCSVField(s.connected_at || ""),
      escapeCSVField(s.disconnected_at || "Active"),
      escapeCSVField(duration),
      escapeCSVField(s.ip_address || "Unknown"),
      escapeCSVField(s.user_agent || ""),
      escapeCSVField(String(s.id)),
    ];
  });

  // Combine headers and rows
  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  // Create blob and download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Escape CSV field - handle commas, quotes, and newlines
 */
function escapeCSVField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
