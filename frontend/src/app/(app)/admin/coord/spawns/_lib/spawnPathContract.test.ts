/**
 * The pin between the matrix's hand-kept knowledge and the kinds coord serves
 * (plan `2026-10-23-console-presentation-spaces` Phase 4: "a test pins the
 * hand list against the served kinds so a new served kind cannot be silently
 * missing from the matrix").
 *
 * 1. **The copy is the contract.** `spawn_authorization.json` at the commit
 *    `spawn-contract.pin.toml` pins must hold exactly the kinds and seeded
 *    classes `spawnPathContract.ts` copies — so a bump past a new kind fails
 *    HERE until the matrix knows it. CI fetches that file
 *    (`.github/actions/spawn-contract`); locally it comes from the
 *    qontinui-schemas checkout beside this repository. There is no third
 *    outcome: a file that cannot be had at the pinned digest is RED.
 * 2. **The hand list holds only what nothing serves.** No hand-kept row may
 *    carry a served kind's or class's name: it would shadow, or duplicate, the
 *    row coord serves.
 * 3. **Every served kind has reviewed words**, and a served kind the words do
 *    not know is still a row.
 * 4. **No served kind is dropped.** A registry serving every contract kind
 *    yields exactly one row for each.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFx } from "../__fixtures__/coordSpawns";
import {
  defaultsBody,
  effectiveBody,
  effectiveFx,
  mergeSettingsRead,
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
const REPO_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  ".."
);
const SIBLING_REPO = join(REPO_ROOT, "..", SPAWN_CONTRACT_SOURCE.repo);
const SIBLING_CONTRACT = join(SIBLING_REPO, SPAWN_CONTRACT_SOURCE.path);
const OVERRIDE_VAR = "QONTINUI_SPAWN_CONTRACT_FILE";

interface ContractFile {
  spawn_paths: string[];
  kind_seeds: Array<{ agent_name: string; spawn_path: string }>;
  class_seeds: Array<{ spawn_path: string; seeded: boolean }>;
}

function readPin(): { ref: string; sha256: string } {
  const text = readFileSync(join(REPO_ROOT, "spawn-contract.pin.toml"), "utf8");
  const ref = /^ref = "([0-9a-f]{40})"$/m.exec(text)?.[1];
  const sha256 = /^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1];
  if (!ref || !sha256) {
    throw new Error("spawn-contract.pin.toml must carry ref and sha256");
  }
  return { ref, sha256 };
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The contract's bytes at the pin, or a throw naming what was found. Under CI
 * or with the override there is no fallback: that file at the pinned digest,
 * or red naming both digests. Locally: the sibling's file when it is at the
 * pinned digest, else the pinned blob out of the sibling's objects.
 */
function resolveContract(
  env: Record<string, string | undefined>,
  pin: { ref: string; sha256: string }
): string {
  const atDigest = (bytes: Buffer, from: string): string => {
    const got = sha256Of(bytes);
    if (got !== pin.sha256) {
      throw new Error(
        `${from} has sha256 ${got}; spawn-contract.pin.toml pins ${pin.sha256} at ${pin.ref}`
      );
    }
    return bytes.toString("utf8");
  };
  const override = env[OVERRIDE_VAR];
  if (override || env.GITHUB_ACTIONS) {
    if (!override || !existsSync(override)) {
      throw new Error(
        `CI reads the contract from $${OVERRIDE_VAR} (.github/actions/spawn-contract), and ${override ?? "it is unset"}${override ? " is absent" : ""}; spawn-contract.pin.toml pins ${pin.sha256} at ${pin.ref}`
      );
    }
    return atDigest(readFileSync(override), override);
  }
  if (
    existsSync(SIBLING_CONTRACT) &&
    sha256Of(readFileSync(SIBLING_CONTRACT)) === pin.sha256
  ) {
    return readFileSync(SIBLING_CONTRACT, "utf8");
  }
  const blob = `${pin.ref}:${SPAWN_CONTRACT_SOURCE.path}`;
  let bytes: Buffer;
  try {
    bytes = execFileSync("git", ["-C", SIBLING_REPO, "show", blob], {
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      `${blob} could not be read from ${SIBLING_REPO}: run \`git -C ../${SPAWN_CONTRACT_SOURCE.repo} fetch\`, or check it out beside this repository. spawn-contract.pin.toml pins ${pin.sha256}`
    );
  }
  return atDigest(bytes, blob);
}

describe("the matrix's copy of the spawn contract", () => {
  it("resolves the sibling path from this file", () => {
    expect(existsSync(join(REPO_ROOT, "frontend", "package.json"))).toBe(true);
  });

  it("holds exactly the kinds and seeded classes of the contract at the pinned commit", () => {
    const contract = JSON.parse(
      resolveContract(process.env, readPin())
    ) as ContractFile;
    expect(
      contract.kind_seeds.map((k) => ({
        agentName: k.agent_name,
        spawnPath: k.spawn_path,
      })),
      `qontinui-schemas ${SPAWN_CONTRACT_SOURCE.path} changed its kind_seeds: copy them into spawnPathContract.ts and give each new kind its words in spawnPathCatalog.ts`
    ).toEqual(SPAWN_KIND_SEEDS);
    expect(contract.spawn_paths).toEqual([...SPAWN_CLASSES]);
    expect(
      contract.class_seeds.filter((c) => c.seeded).map((c) => c.spawn_path)
    ).toEqual([...SEEDED_CLASS_ROWS]);
  });

  it("refuses a file at any other digest, naming both", () => {
    const pin = readPin();
    const wrong = join(REPO_ROOT, "frontend", "package.json");
    const got = sha256Of(readFileSync(wrong));
    for (const env of [
      { [OVERRIDE_VAR]: wrong },
      { GITHUB_ACTIONS: "true", [OVERRIDE_VAR]: wrong },
    ]) {
      expect(() => resolveContract(env, pin)).toThrow(got);
      expect(() => resolveContract(env, pin)).toThrow(pin.sha256);
    }
  });

  it("is red under CI when the fetched file is missing, with no fallback to a sibling", () => {
    const pin = readPin();
    expect(() => resolveContract({ GITHUB_ACTIONS: "true" }, pin)).toThrow(
      OVERRIDE_VAR
    );
    expect(() =>
      resolveContract(
        {
          GITHUB_ACTIONS: "true",
          [OVERRIDE_VAR]: "/nonexistent/contract.json",
        },
        pin
      )
    ).toThrow("/nonexistent/contract.json");
  });
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
      defaults: {
        data: defaultsBody().agents,
        error: null,
        asOfMs: 1,
        loading: false,
      },
      nextStep: {
        data: nextStepBody(),
        error: null,
        asOfMs: 1,
        loading: false,
      },
      mergeSettings: mergeSettingsRead(),
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
      effective: {
        data: effectiveBody().agents,
        error: null,
        asOfMs: 1,
        loading: false,
      },
      defaults: {
        data: defaultsBody().agents,
        error: null,
        asOfMs: 1,
        loading: false,
      },
      nextStep: {
        data: nextStepBody(),
        error: null,
        asOfMs: 1,
        loading: false,
      },
      mergeSettings: mergeSettingsRead(),
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
