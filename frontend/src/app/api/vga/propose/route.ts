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

import { NextResponse, type NextRequest } from "next/server";

import {
  GroundingUnavailableError,
  groundOnce,
} from "@/lib/vga/grounding-client";
import { proposeRequestSchema } from "@/lib/vga/schemas";
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

  try {
    const proposals: VgaProposal[] = [];
    for (const category of categories) {
      const prompt = buildCategoryPrompt(category);
      const result = await groundOnce({
        imageBase64: parsed.data.imageBase64,
        prompt,
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
    }

    return NextResponse.json({ proposals: dedupe(proposals) });
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
