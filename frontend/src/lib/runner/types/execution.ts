// =============================================================================
// Execution Types
// =============================================================================

export interface ShellCommand {
  id: string;
  name: string;
  command: string;
  working_directory?: string;
  timeout_seconds?: number;
  description?: string;
  category?: string;
  tags?: string[];
  fail_on_error?: boolean;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}
