/**
 * POST /api/vga/ground
 *
 * Thin server-side proxy to the llama-swap OpenAI-compat endpoint.
 * Browser code never sees the model URL directly so we can swap v5/v6
 * out without touching the web client.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  GroundingParseError,
  GroundingUnavailableError,
  groundOnce,
} from "@/lib/vga/grounding-client";
import { groundRequestSchema } from "@/lib/vga/schemas";

/** Half-edge of the bbox we return around the predicted point. */
const BOX_HALF = 20;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = groundRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await groundOnce(parsed.data);

    if (result.x === null || result.y === null) {
      return NextResponse.json(
        {
          x: null,
          y: null,
          rawResponse: result.rawResponse,
          confidence: 0,
          boxHalf: BOX_HALF,
          message: "Model reported <none/>",
        },
        { status: 200 }
      );
    }

    // Normalized coords are useful for the builder overlay layer when
    // it has the screenshot dimensions handy — keep them here.
    // Since we don't know the image dimensions server-side, return
    // `null` for normX/normY and let the caller compute if needed.
    return NextResponse.json({
      x: result.x,
      y: result.y,
      normX: null,
      normY: null,
      boxHalf: BOX_HALF,
      rawResponse: result.rawResponse,
      confidence: result.confidence,
    });
  } catch (err) {
    if (err instanceof GroundingParseError) {
      return NextResponse.json(
        {
          error: "Failed to parse model response",
          rawResponse: err.rawResponse,
        },
        { status: 502 }
      );
    }
    if (err instanceof GroundingUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unknown grounding error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
