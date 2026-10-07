import { describe, it, expect } from "vitest";
import {
  resumeBlockedReason,
  transcriptText,
  unknownReasonText,
  verdictLabel,
} from "./unfinished";
import type { UnfinishedSession, UnfinishedSessionsView } from "../types";

const row = (over: Partial<UnfinishedSession> = {}): UnfinishedSession => ({
  claude_session_id: "c",
  coord_session_id: "s",
  device_id: "d",
  hostname: "h",
  account_label: ".claude-x",
  config_dir: null,
  working_dir: null,
  worktree_path: null,
  work_unit_slug: null,
  last_acted_at: null,
  closed_at: null,
  liveness: "process_gone",
  liveness_basis: "census",
  transcript: { coord_warm_bytes: 0, coord_cold: false },
  last_resume_attempt_at: null,
  resume_verdict: null,
  ...over,
});

describe("unfinished helpers", () => {
  it("blocks resume only when the device is unrecorded", () => {
    expect(resumeBlockedReason(row())).toBeNull();
    expect(resumeBlockedReason(row({ device_id: null }))).toMatch(/device/);
  });
  it("a null verdict reads as never swept, not as a verdict", () => {
    expect(verdictLabel(null)).toBe("not swept yet");
    expect(verdictLabel("A")).toBe("A");
  });
  it("names coord's reason for UNKNOWN", () => {
    const v = (reason: string | null): UnfinishedSessionsView => ({
      state: "unknown",
      reason,
      detail: null,
      sessions: null,
      truncated: false,
    });
    expect(unknownReasonText(v("schema_migration_pending"))).toMatch(
      /migrated/
    );
    expect(unknownReasonText(v(null))).toMatch(/no reason/);
  });
  it("an absent transcript block is unknown", () => {
    expect(transcriptText(row({ transcript: null }))).toBe(
      "transcript unknown"
    );
  });
});
