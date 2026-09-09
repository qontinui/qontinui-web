/**
 * The TWO transcript stores — that they stay two, and that every non-answer
 * renders as a dash rather than as a zero.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` §1 + Phase 2. The
 * assertion that matters most is the negative one: **no state below may render
 * `0`, `false`, "closed" or "no transcript"** for something nobody
 * established. A closed session's warm rows are garbage-collected 7 days after
 * it ends, so an empty warm tier is evidence of nothing at all.
 */

import { describe, expect, it, vi } from "vitest";

import {
  archiveHref,
  archiveQueryFor,
  archivedTranscriptIndicator,
  liveTranscriptIndicator,
  probeArchivedTranscript,
  probeLiveTranscript,
  type ArchivedTranscript,
  type LiveTranscript,
} from "./transcriptStores";
import type { OutputHistoryResponse } from "./types";
import type { SessionArtifactListResponse } from "@/components/session-repository/types";

const NO_CHUNKS: OutputHistoryResponse = {
  session_id: "s",
  tier: "warm",
  chunks: [],
  count: 0,
};

const ONE_CHUNK: OutputHistoryResponse = {
  session_id: "s",
  tier: "warm",
  chunks: [{ chunk_offset: 0, payload_b64: "aGk=" }],
  count: 1,
};

function artifactPage(
  over: Partial<SessionArtifactListResponse["items"][number]> = {}
): SessionArtifactListResponse {
  return {
    total: 1,
    offset: 0,
    limit: 10,
    items: [
      {
        id: "artifact-1",
        organization_id: null,
        claude_session_id: "claude-1",
        account_label: "work",
        tenant_id: null,
        tenant_source: "declared",
        device_id: null,
        machine_hostname: null,
        coord_session_id: "coord-1",
        work_unit_slug: null,
        task_run_id: null,
        config_dir: null,
        working_dir: null,
        repo: null,
        git_branch: null,
        provider: null,
        launch_command: null,
        restore_tier: null,
        machine_id: null,
        permission_mode: null,
        body_object_key: "k",
        content_sha256: "abc",
        byte_count: 10,
        turn_count: 4,
        first_prompt: null,
        last_prompt: null,
        ai_title: null,
        session_name: null,
        name_source: null,
        body_source: "disk_verbatim",
        started_at: null,
        last_activity_at: null,
        ended_at: null,
        state: "closed",
        closeout_state: "clean",
        secret_finding_count: 0,
        secret_finding_kinds: [],
        created_at: "2026-08-26T00:00:00Z",
        updated_at: "2026-08-26T00:00:00Z",
        ...over,
      },
    ],
  } as SessionArtifactListResponse;
}

/**
 * The claim no dash may make. Deliberately narrow: several of these sentences
 * legitimately contain the WORDS "no transcript" while explicitly refusing the
 * claim ("this is unknown, not 'no transcript'"), so a keyword ban would fail
 * the honest strings and pass a dishonest one that phrased it differently.
 * What is forbidden is the ASSERTION.
 */
const ASSERTS_ABSENCE =
  /\bthere (?:is|was|are|were) no transcript\b|\bhas no transcript\b|\bhad no transcript\b(?! *[.\u2014-])/i;

/** Every dash must name WHICH unknown it is, not merely be a dash. */
const NAMES_THE_UNKNOWN =
  /unknown|not applicable|not a claim|not probed|not proof|no answer yet|did not land/i;

// ---------------------------------------------------------------------------
// The indicators
// ---------------------------------------------------------------------------

describe("the per-row indicator — warm / cold / – (Phase 2)", () => {
  it("names the tier only when a tier actually answered", () => {
    expect(liveTranscriptIndicator({ state: "present", tier: "warm" })).toMatchObject(
      { label: "warm", unknown: false }
    );
    expect(liveTranscriptIndicator({ state: "present", tier: "cold" })).toMatchObject(
      { label: "cold", unknown: false }
    );
  });

  it.each<[string, LiveTranscript]>([
    ["unprobed", { state: "unprobed" }],
    ["probing", { state: "probing" }],
    ["silent", { state: "silent" }],
    ["failed", { state: "failed", detail: "502" }],
    [
      "not-applicable",
      {
        state: "not-applicable",
        why: "coord reports no Claude Code session id for this session — not applicable, not missing.",
      },
    ],
  ])("renders – for %s, and never claims there is no transcript", (_n, live) => {
    const indicator = liveTranscriptIndicator(live);
    expect(indicator.label).toBe("–");
    expect(indicator.unknown).toBe(true);
    expect(indicator.label).not.toMatch(/closed|false|^0$/i);
    expect(indicator.title).not.toMatch(ASSERTS_ABSENCE);
    // Every dash says WHICH unknown it is — a bare dash is only honest if the
    // reader can find out what it means.
    expect(indicator.title).toMatch(NAMES_THE_UNKNOWN);
  });

  it("an UNPROBED row says so — it has not answered, it has not denied", () => {
    expect(liveTranscriptIndicator({ state: "unprobed" }).title).toMatch(
      /not probed/i
    );
  });

  it("a SILENT probe still refuses to conclude there is none", () => {
    const title = liveTranscriptIndicator({ state: "silent" }).title;
    expect(title).toMatch(/not proof/i);
    expect(title).toMatch(/unknown/i);
  });
});

describe("the permanent archive's indicator", () => {
  it("says 'archived' when the archive holds a row", () => {
    const indicator = archivedTranscriptIndicator({
      state: "present",
      rows: [
        {
          artifactId: "a1",
          claudeSessionId: "c1",
          accountLabel: null,
          bodySource: "disk_verbatim",
          contentSha256: "x",
          turnCount: 1,
          byteCount: 1,
          lastActivityAt: null,
        },
      ],
    });
    expect(indicator).toMatchObject({ label: "archived", unknown: false });
  });

  it.each<[string, ArchivedTranscript]>([
    ["unprobed", { state: "unprobed" }],
    ["probing", { state: "probing" }],
    ["absent", { state: "absent" }],
    ["failed", { state: "failed", detail: "500" }],
    [
      "unaddressable",
      {
        state: "unaddressable",
        why: "no session id in either coord id space is known — unknown, not absent.",
      },
    ],
  ])("renders – for %s, never 'no transcript'", (_n, archived) => {
    const indicator = archivedTranscriptIndicator(archived);
    expect(indicator.label).toBe("–");
    expect(indicator.unknown).toBe(true);
    expect(indicator.title).not.toMatch(ASSERTS_ABSENCE);
    expect(indicator.title).toMatch(NAMES_THE_UNKNOWN);
  });

  it("an ABSENT archive row is a dash, and says nothing about the session", () => {
    // The plan is explicit: "a session with no artifact row renders –, not
    // 'no transcript'".
    const title = archivedTranscriptIndicator({ state: "absent" }).title;
    expect(title).toMatch(/holds no row/i);
    expect(title).toMatch(/not a claim/i);
  });
});

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

describe("the live probe walks warm then cold, and only for a closed session", () => {
  it("reports warm without touching the cold tier", async () => {
    const read = vi.fn(async () => ONE_CHUNK);
    await expect(
      probeLiveTranscript("s", { read, sessionClosed: true })
    ).resolves.toEqual({ state: "present", tier: "warm" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]).toMatchObject({
      tier: "warm",
      stream: "transcript",
      limit: 1,
    });
  });

  it("falls back to cold for a CLOSED session whose warm tier is empty", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(NO_CHUNKS)
      .mockResolvedValueOnce({ ...ONE_CHUNK, tier: "cold" });
    await expect(
      probeLiveTranscript("s", { read, sessionClosed: true })
    ).resolves.toEqual({ state: "present", tier: "cold" });
    expect(read.mock.calls[1][1]).toMatchObject({ tier: "cold" });
  });

  it("does NOT read cold for an OPEN session — its history is not archived yet", async () => {
    const read = vi.fn(async () => NO_CHUNKS);
    await expect(
      probeLiveTranscript("s", { read, sessionClosed: false })
    ).resolves.toEqual({ state: "silent" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a failed WARM read is `failed`, never `silent` — we did not look", async () => {
    const read = vi.fn(async () => {
      throw new Error("GET /output failed: 502 - down");
    });
    const result = await probeLiveTranscript("s", {
      read,
      sessionClosed: true,
    });
    expect(result.state).toBe("failed");
    if (result.state !== "failed") throw new Error("unreachable");
    expect(result.detail).toContain("502");
  });

  it("a cold tier that is not configured (503) lands on silent, not failed", async () => {
    // The warm read already ANSWERED (empty). The cold 503 adds no
    // information, and reporting a hard failure would overstate it.
    const read = vi
      .fn()
      .mockResolvedValueOnce(NO_CHUNKS)
      .mockRejectedValueOnce(new Error("GET /output failed: 503 - no cold tier"));
    await expect(
      probeLiveTranscript("s", { read, sessionClosed: true })
    ).resolves.toEqual({ state: "silent" });
  });
});

describe("the archive probe — the forward half of the round trip", () => {
  it("prefers the INDEXED claude_session_id when both ids are known", () => {
    expect(
      archiveQueryFor({ claudeSessionId: "c1", coordSessionId: "k1" })
    ).toEqual({ claudeSessionId: "c1" });
  });

  it("falls back to the coord id when that is all the row has", () => {
    expect(archiveQueryFor({ coordSessionId: "k1" })).toEqual({
      coordSessionId: "k1",
    });
  });

  it("is unaddressable — not absent — with neither id", async () => {
    const list = vi.fn();
    const result = await probeArchivedTranscript({}, { list });
    expect(result.state).toBe("unaddressable");
    expect(list).not.toHaveBeenCalled();
  });

  it("finds the artifact and hands back the /sessions/repository link", async () => {
    const list = vi.fn(async () => artifactPage());
    const result = await probeArchivedTranscript(
      { claudeSessionId: "claude-1" },
      { list }
    );
    expect(list.mock.calls[0][0]).toMatchObject({
      claudeSessionId: "claude-1",
    });
    if (result.state !== "present") throw new Error("expected present");
    expect(result.rows[0].artifactId).toBe("artifact-1");
    expect(archiveHref(result.rows[0])).toBe(
      "/sessions/repository/artifact-1"
    );
  });

  it("an EMPTY archive page is `absent`, and a failed read is `failed`", async () => {
    const empty = vi.fn(async () => ({
      ...artifactPage(),
      items: [],
      total: 0,
    }));
    await expect(
      probeArchivedTranscript({ claudeSessionId: "c" }, { list: empty })
    ).resolves.toEqual({ state: "absent" });

    const broken = vi.fn(async () => {
      throw new Error("GET /session-repository failed: 500");
    });
    const result = await probeArchivedTranscript(
      { claudeSessionId: "c" },
      { list: broken }
    );
    expect(result.state).toBe("failed");
  });

  it("keeps EVERY archived copy — identity is (session id, account label)", async () => {
    const two = artifactPage();
    two.items = [
      two.items[0],
      { ...two.items[0], id: "artifact-2", account_label: "personal" },
    ];
    two.total = 2;
    const result = await probeArchivedTranscript(
      { claudeSessionId: "claude-1" },
      { list: vi.fn(async () => two) }
    );
    if (result.state !== "present") throw new Error("expected present");
    expect(result.rows).toHaveLength(2);
  });
});
