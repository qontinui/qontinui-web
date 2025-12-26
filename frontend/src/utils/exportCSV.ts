import type { RunnerConnection } from "@/types/runner";
import { formatDuration } from "./formatDuration";

/**
 * Export connection history as CSV file
 */
export function exportConnectionHistoryCSV(
  connections: RunnerConnection[],
  filename: string = "connection-history.csv"
): void {
  if (connections.length === 0) {
    console.warn("No connections to export");
    return;
  }

  // Define CSV headers
  const headers = [
    "Runner Name",
    "Connected At",
    "Disconnected At",
    "Duration",
    "IP Address",
    "Project ID",
    "Project Name",
    "Connection ID",
  ];

  // Convert connections to CSV rows
  const rows = connections.map((conn) => {
    const duration = conn.duration_seconds
      ? formatDuration(conn.duration_seconds)
      : conn.disconnected_at
        ? "Calculating..."
        : "Active";

    return [
      escapeCSVField(conn.runner_name || "Unknown"),
      escapeCSVField(conn.connected_at || ""),
      escapeCSVField(conn.disconnected_at || "Active"),
      escapeCSVField(duration),
      escapeCSVField(conn.ip_address || "Unknown"),
      escapeCSVField(conn.project_id?.toString() || ""),
      escapeCSVField(conn.project_name || ""),
      escapeCSVField(conn.id.toString()),
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
