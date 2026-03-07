// ============================================================================
// Dev Dashboard Types
// Mirrors the backend FleetStatus / AggregatedTaskRuns API shapes.
// ============================================================================

export interface RegisteredRunner {
  id: string; // "hostname:port"
  hostname: string;
  ip: string;
  port: number;
  instance_name: string | null;
  os: string; // "windows" | "macos" | "linux"
  os_version: string | null;
  running_task_count: number;
  running_task_ids: string[];
  last_heartbeat: string; // ISO datetime
  is_healthy: boolean;
}

export interface ClaudeSessionInfo {
  pid: number;
  working_directory: string | null;
  started_at: string | null;
}

export interface FleetStatus {
  runners: RegisteredRunner[];
  claude_sessions: Record<string, ClaudeSessionInfo[]>; // hostname -> sessions
  total_runners: number;
  total_healthy: number;
  total_running_tasks: number;
  total_claude_sessions: number;
}

export interface RunnerTaskRun {
  id: string;
  runner_id: string;
  runner_hostname: string;
  runner_port: number;
  status: string;
  prompt: string | null;
  started_at: string | null;
  workflow_name: string | null;
}

export interface AggregatedTaskRuns {
  task_runs: RunnerTaskRun[];
  total: number;
}

/** Group runners by hostname for the machine-card grid. */
export interface MachineGroup {
  hostname: string;
  runners: RegisteredRunner[];
  claudeSessions: ClaudeSessionInfo[];
}
