// ============================================================================
// Commit lineage — types
//
// Wire shapes for the commit-lineage feed proxied through the web backend
// (`/api/v1/operations/lineage/*` → coord `coord.commit_lineage`). These
// mirror coord's `commit_lineage.rs` JSON projection exactly. Ported from
// the dev-only supervisor's Lineage tab so the same "which session produced
// which commit" view lives in the customer-facing app.
// ============================================================================

/** One row of `coord.commit_lineage`. */
export interface LineageRow {
  commit_sha: string;
  repo: string;
  branch: string | null;
  pr_number: number | null;
  agent_session_id: string | null;
  session_name: string | null;
  /** 'merge_orchestrator' | 'push_report' | 'trailer_backfill' */
  source: string;
  recorded_at: string | null;
}

/** `{rows, count, limit}` envelope from `GET /coord/lineage/recent`. */
export interface RecentCommitsResponse {
  rows: LineageRow[];
  count: number;
  limit: number;
}

/** `{session_id, commits, count}` envelope from coord's session-commits route. */
export interface SessionCommitsResponse {
  session_id: string;
  commits: LineageRow[];
  count: number;
}

export interface LineageTotals {
  commits: number;
  attributed: number;
  sessions: number;
  repos: number;
}

export interface LineageBySource {
  source: string;
  commits: number;
}

export interface LineageTopSession {
  agent_session_id: string;
  session_name: string | null;
  commits: number;
  last_commit_at: string | null;
}

export interface LineageByRepoDay {
  repo: string;
  day: string;
  commits: number;
  sessions: number;
}

/** Full body of `GET /coord/lineage/stats`. */
export interface LineageStats {
  totals: LineageTotals;
  by_source: LineageBySource[];
  top_sessions: LineageTopSession[];
  by_repo_day: LineageByRepoDay[];
}
