import type { RunnerConnection } from '@/types/runner';
import { formatDuration } from './formatDuration';

/**
 * Export connection history as CSV file
 */
export function exportConnectionHistoryCSV(
  connections: RunnerConnection[],
  filename: string = 'connection-history.csv'
): void {
  if (connections.length === 0) {
    console.warn('No connections to export');
    return;
  }

  // Define CSV headers
  const headers = [
    'Runner Name',
    'Connected At',
    'Disconnected At',
    'Duration',
    'IP Address',
    'Project ID',
    'Project Name',
    'Connection ID',
    'Token ID'
  ];

  // Convert connections to CSV rows
  const rows = connections.map(conn => {
    const duration = conn.duration_seconds
      ? formatDuration(conn.duration_seconds)
      : conn.disconnected_at
      ? 'Calculating...'
      : 'Active';

    return [
      escapeCSVField(conn.runner_name || 'Unknown'),
      escapeCSVField(conn.connected_at || ''),
      escapeCSVField(conn.disconnected_at || 'Active'),
      escapeCSVField(duration),
      escapeCSVField(conn.ip_address || 'Unknown'),
      escapeCSVField(conn.project_id?.toString() || ''),
      escapeCSVField(conn.project_name || ''),
      escapeCSVField(conn.id.toString()),
      escapeCSVField(conn.runner_token_id || '')
    ];
  });

  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
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
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Export runner tokens as CSV file
 */
export function exportRunnerTokensCSV(
  tokens: any[],
  filename: string = 'runner-tokens.csv'
): void {
  if (tokens.length === 0) {
    console.warn('No tokens to export');
    return;
  }

  const headers = [
    'Token ID',
    'Name',
    'Created At',
    'Expires At',
    'Last Used At',
    'Status',
    'IP Address',
    'Connection Count'
  ];

  const rows = tokens.map(token => [
    escapeCSVField(token.id || ''),
    escapeCSVField(token.name || ''),
    escapeCSVField(token.created_at || ''),
    escapeCSVField(token.expires_at || 'Never'),
    escapeCSVField(token.last_used_at || 'Never'),
    escapeCSVField(token.is_revoked ? 'Revoked' : 'Active'),
    escapeCSVField(token.last_ip_address || 'Unknown'),
    escapeCSVField(token.connection_count?.toString() || '0')
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
