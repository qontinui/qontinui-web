/**
 * POST /api/vga/propose
 *
 * Multi-element proposer. For each category in the list, issues a
 * targeted grounding prompt to llama-swap. Deduplicates near-neighbour
 * hits (<20px Euclidean distance) so a single "Button" element isn't
 * emitted twice when two categories both resolve to it.
 *
 * v5 is a single-point grounding model; this is the category-iteration
 * strategy described in plan §4.
 */

import { after, NextResponse, type NextRequest } from "next/server";

import {
  GroundingUnavailableError,
  groundOnce,
} from "@/lib/vga/grounding-client";
import { readImageDims } from "@/lib/vga/image-dims";
import { proposeRequestSchema } from "@/lib/vga/schemas";
import { logShadowSample } from "@/lib/vga/shadow-log";
import type { VgaProposal } from "@/lib/types/vga";

const DEFAULT_CATEGORIES = [
  "Button",
  "Input",
  "Tab",
  "Link",
  "Icon",
  "Label",
] as const;

const DEDUPE_PX = 20;

/** Half-edge of the bbox we log with shadow samples. Matches /api/vga/ground. */
const SHADOW_BOX_HALF = 20;

/** Default grounding model string recorded on shadow samples. */
const DEFAULT_MODEL = "qontinui-grounding-v5";

function buildCategoryPrompt(category: string): string {
  return (
    `Locate the most prominent ${category} in the screenshot. ` +
    `Reply with <point>x y</point> or <none/> if absent.`
  );
}

function dedupe(proposals: VgaProposal[]): VgaProposal[] {
  const kept: VgaProposal[] = [];
  for (const p of proposals) {
    const dupe = kept.find((k) => Math.hypot(k.x - p.x, k.y - p.y) < DEDUPE_PX);
    if (!dupe) kept.push(p);
  }
  return kept;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = proposeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const categories = parsed.data.categories ?? [...DEFAULT_CATEGORIES];
  const dims = readImageDims(parsed.data.imageBase64);

  try {
    const proposals: VgaProposal[] = [];
    for (const category of categories) {
      const prompt = buildCategoryPrompt(category);
      const result = await groundOnce({
        imageBase64: parsed.data.imageBase64,
        prompt,
        imageWidth: dims?.width,
        imageHeight: dims?.height,
      });
      if (result.x === null || result.y === null) continue;
      proposals.push({
        label: category,
        prompt,
        x: result.x,
        y: result.y,
        confidence: result.confidence,
        category,
      });

      // Fire-and-forget shadow-sample write for each non-<none/>
      // proposal. Mirrors the /api/vga/ground side effect so the v6
      // training gate sees multi-element proposals too — the builder
      // runs /propose far more often than /ground. ``after()`` keeps
      // the write alive past the response (see ground/route.ts).
      const px = result.x;
      const py = result.y;
      const imageBase64 = parsed.data.imageBase64;
      const stateMachineId = parsed.data.stateMachineId;
      const targetProcess = parsed.data.targetProcess;
      const { confidence } = result;
      after(async () => {
        await logShadowSample({
          imageBase64,
          prompt,
          predictedBbox: {
            x: Math.max(0, px - SHADOW_BOX_HALF),
            y: Math.max(0, py - SHADOW_BOX_HALF),
            w: SHADOW_BOX_HALF * 2,
            h: SHADOW_BOX_HALF * 2,
          },
          modelUsed: DEFAULT_MODEL,
          confidence,
          stateMachineId,
          targetProcess,
        });
      });
    }

    return NextResponse.json({
      proposals: dedupe(proposals),
      imageWidth: dims?.width ?? null,
      imageHeight: dims?.height ?? null,
    });
  } catch (err) {
    if (err instanceof GroundingUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Proposer failure", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
