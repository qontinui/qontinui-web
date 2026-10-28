/**
 * The pin between the matrix's hand-kept knowledge and the kinds coord serves
 * (plan `2026-10-23-console-presentation-spaces` Phase 4: "a test pins the
 * hand list against the served kinds so a new served kind cannot be silently
 * missing from the matrix").
 *
 * 1. **The copy is the contract.** When the qontinui-schemas checkout beside
 *    this repository is present, its `spawn_authorization.json` must hold
 *    exactly the kinds and seeded classes `spawnPathContract.ts` copies — so a
 *    kind added there fails HERE until the matrix knows it. Without that
 *    checkout (CI checks out this repository alone) the comparison is
 *    reported as skipped, never as passed.
 * 2. **The hand list holds only what nothing serves.** No hand-kept row may
 *    carry a served kind's or class's name: it would shadow, or duplicate, the
 *    row coord serves.
 * 3. **Every served kind has reviewed words**, and a served kind the words do
 *    not know is still a row.
 * 4. **No served kind is dropped.** A registry serving every contract kind
 *    yields exactly one row for each.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAutoFixPr } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import { listFx } from "../__fixtures__/coordSpawns";
import {
  defaultsBody,
  effectiveBody,
  effectiveFx,
  mergeSettingsBody,
  nextStepBody,
} from "../__fixtures__/spawnPaths";
import { SERVED_PATH_WORDS, UNSERVED_PATHS } from "./spawnPathCatalog";
import {
  SEEDED_CLASS_ROWS,
  SPAWN_CLASSES,
  SPAWN_CONTRACT_SOURCE,
  SPAWN_KIND_SEEDS,
} from "./spawnPathContract";
import { deriveSpawnPathMatrix } from "./spawnPathMatrix";

/** `qontinui-web/frontend/src/app/(app)/admin/coord/spawns/_lib` → workspace. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..", "..", "..");
const SIBLING_CONTRACT = join(
  REPO_ROOT,
  "..",
  SPAWN_CONTRACT_SOURCE.repo,
  SPAWN_CONTRACT_SOURCE.path
);

interface ContractFile {
  spawn_paths: string[];
  kind_seeds: Array<{ agent_name: string; spawn_path: string }>;
  class_seeds: Array<{ spawn_path: string; seeded: boolean }>;
}

const sibling = existsSync(SIBLING_CONTRACT);

describe("the matrix's copy of the spawn contract", () => {
  it("resolves the sibling path from this file", () => {
    // The path arithmetic is checked even where the sibling is absent: a
    // wrong depth would make the comparison below skip everywhere, silently.
    expect(existsSync(join(REPO_ROOT, "frontend", "package.json"))).toBe(true);
  });

  it.skipIf(!sibling)(
    "holds exactly the kinds and seeded classes of the qontinui-schemas checkout beside this repository",
    () => {
      const contract = JSON.parse(
        readFileSync(SIBLING_CONTRACT, "utf8")
      ) as ContractFile;
      expect(
        contract.kind_seeds.map((k) => ({
          agentName: k.agent_name,
          spawnPath: k.spawn_path,
        })),
        `qontinui-schemas ${SPAWN_CONTRACT_SOURCE.path} changed its kind_seeds: copy them into spawnPathContract.ts, give each new kind its words in spawnPathCatalog.ts, and re-pin the commit`
      ).toEqual(SPAWN_KIND_SEEDS);
      expect(contract.spawn_paths).toEqual([...SPAWN_CLASSES]);
      expect(
        contract.class_seeds.filter((c) => c.seeded).map((c) => c.spawn_path)
      ).toEqual([...SEEDED_CLASS_ROWS]);
    }
  );
});

describe("the hand-kept rows hold only what nothing serves", () => {
  it("names no served kind or class", () => {
    const served = new Set<string>([
      ...SPAWN_KIND_SEEDS.map((k) => k.agentName),
      ...SPAWN_CLASSES,
    ]);
    for (const path of UNSERVED_PATHS) {
      expect(served.has(path.key), path.key).toBe(false);
    }
  });

  it("does not shadow a served row the matrix built, whatever coord serves", () => {
    // A coord that one day serves a row named like a hand-kept path must not
    // end up with two rows under one key.
    const agents = [
      ...effectiveBody().agents,
      effectiveFx("post_merge_followup", "standing_continuation"),
    ];
    const m = deriveSpawnPathMatrix({
      effective: { data: agents, error: null, asOfMs: 1, loading: false },
      defaults: { data: defaultsBody().agents, error: null, asOfMs: 1, loading: false },
      nextStep: { data: nextStepBody(), error: null, asOfMs: 1, loading: false },
      autoFixPr: { loading: false, error: null, state: readAutoFixPr(mergeSettingsBody().profile) },
      followup: { loading: false, repos: [], reposError: null, readings: {} },
      ledger: { list: listFx([]), issue: null, windowLabel: "last 7 days" },
      writes: {},
      presenting: false,
    });
    // Coord's row wins: the hand list exists only for what nothing serves.
    const rows = m.rows.filter((r) => r.key === "post_merge_followup");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("served");
  });
});

describe("every served kind is on the matrix", () => {
  it("has reviewed words for every contract kind and class", () => {
    for (const k of SPAWN_KIND_SEEDS) {
      expect(SERVED_PATH_WORDS[k.agentName], k.agentName).toBeDefined();
    }
    for (const c of SPAWN_CLASSES) {
      expect(SERVED_PATH_WORDS[c], c).toBeDefined();
    }
  });

  it("builds exactly one row for each kind and seeded class coord serves", () => {
    const m = deriveSpawnPathMatrix({
      effective: { data: effectiveBody().agents, error: null, asOfMs: 1, loading: false },
      defaults: { data: defaultsBody().agents, error: null, asOfMs: 1, loading: false },
      nextStep: { data: nextStepBody(), error: null, asOfMs: 1, loading: false },
      autoFixPr: { loading: false, error: null, state: readAutoFixPr(mergeSettingsBody().profile) },
      followup: { loading: false, repos: [], reposError: null, readings: {} },
      ledger: { list: listFx([]), issue: null, windowLabel: "last 7 days" },
      writes: {},
      presenting: false,
    });
    for (const name of [
      ...SPAWN_KIND_SEEDS.map((k) => k.agentName),
      ...SEEDED_CLASS_ROWS,
    ]) {
      const rows = m.rows.filter((r) => r.key === name);
      expect(rows, name).toHaveLength(1);
      expect(rows[0]?.source, name).toBe("served");
    }
  });
});
