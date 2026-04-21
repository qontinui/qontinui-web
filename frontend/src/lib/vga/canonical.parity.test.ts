/**
 * Cross-repo parity test for VGA canonical JSON (TS side).
 *
 * Paired with `qontinui/tests/test_vga_canonical_parity.py`. Both tests
 * load the same two fixtures under `test-fixtures/vga/` and assert
 * byte-exact agreement with the frozen canonical output. If either
 * encoder drifts, `content_hash` (SHA-256 of the canonical string)
 * silently diverges and imported VGA state machines look "modified"
 * when they are not.
 *
 * Intentional schema changes MUST update both encoders + the fixture
 * + the Python FROZEN_SHA256 constant in a single commit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildCanonicalExport, canonicalJsonString } from "@/lib/vga/canonical";
import type { VgaStateGraphNode, VgaTransitionGraph } from "@/lib/types/vga";

// Repo layout:
//   __dirname = qontinui-web/frontend/src/lib/vga
//   fixtures  = qontinui-web/frontend/test-fixtures/vga (duplicated from
//   the qontinui repo — both copies must stay in sync or the FROZEN_SHA256
//   constants below will diverge and fail this test.)
// vga -> lib -> src -> frontend
const FRONTEND_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(FRONTEND_ROOT, "test-fixtures", "vga");
const INPUT_FIXTURE = path.join(FIXTURE_DIR, "canonical-state-machine.json");
const EXPECTED_FIXTURE = path.join(
  FIXTURE_DIR,
  "canonical-state-machine.canonical.json"
);

// Mirror of FROZEN_SHA256 in the Python test — any intentional schema
// change MUST update both at once.
const FROZEN_SHA256 =
  "1a43fefeca0fe4ec3398bfee78fff41ab37fa05e673db83856e6db21bb070cb4";

/**
 * The input fixture follows the Python model shape (snake_case keys).
 * We type-narrow just the pieces we need to feed `buildCanonicalExport`.
 */
interface InputFixtureElement {
  id: string;
  label: string;
  prompt: string;
  bbox: { x: number; y: number; w: number; h: number };
}

interface InputFixtureState {
  id: string;
  name: string;
  blocking: boolean;
  elements: InputFixtureElement[];
}

interface InputFixture {
  id: string;
  name: string;
  target_process: string;
  target_os: string;
  grounding_model: string;
  private: boolean;
  states: InputFixtureState[];
  transitions: VgaTransitionGraph[];
}

function readInputFixture(): InputFixture {
  const raw = readFileSync(INPUT_FIXTURE, "utf-8");
  return JSON.parse(raw) as InputFixture;
}

function readExpected(): string {
  // Read as utf-8 verbatim. Fixture is stored without a trailing newline
  // and we assert byte-exact equality — do not trim.
  return readFileSync(EXPECTED_FIXTURE, "utf-8");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("VGA canonical JSON parity (TS <-> Python)", () => {
  it("expected fixture has no trailing newline", () => {
    const raw = readFileSync(EXPECTED_FIXTURE);
    expect(raw[raw.length - 1]).not.toBe(0x0a);
  });

  it("TS encoder reproduces the frozen canonical bytes", () => {
    const input = readInputFixture();

    const cleanStates: VgaStateGraphNode[] = input.states.map((s) => ({
      id: s.id,
      name: s.name,
      blocking: s.blocking,
      elements: s.elements.map((e) => ({
        id: e.id,
        label: e.label,
        prompt: e.prompt,
        bbox: e.bbox,
      })),
    }));

    const exportObj = buildCanonicalExport({
      id: input.id,
      name: input.name,
      targetProcess: input.target_process,
      targetOs: input.target_os,
      groundingModel: input.grounding_model,
      private: input.private,
      stateGraph: {
        states: cleanStates,
        transitions: input.transitions,
      },
    });

    const actual = canonicalJsonString(exportObj);
    const expected = readExpected();

    expect(actual).toBe(expected);
  });

  it("SHA-256 of canonical output matches frozen digest", async () => {
    const input = readInputFixture();
    const cleanStates: VgaStateGraphNode[] = input.states.map((s) => ({
      id: s.id,
      name: s.name,
      blocking: s.blocking,
      elements: s.elements.map((e) => ({
        id: e.id,
        label: e.label,
        prompt: e.prompt,
        bbox: e.bbox,
      })),
    }));
    const canon = canonicalJsonString(
      buildCanonicalExport({
        id: input.id,
        name: input.name,
        targetProcess: input.target_process,
        targetOs: input.target_os,
        groundingModel: input.grounding_model,
        private: input.private,
        stateGraph: {
          states: cleanStates,
          transitions: input.transitions,
        },
      })
    );
    const digest = await sha256Hex(canon);
    expect(digest).toBe(FROZEN_SHA256);
  });
});
