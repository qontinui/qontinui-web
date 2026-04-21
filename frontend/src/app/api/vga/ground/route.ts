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
import { readImageDims } from "@/lib/vga/image-dims";
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
    const dims = readImageDims(parsed.data.imageBase64);
    const result = await groundOnce({
      ...parsed.data,
      imageWidth: dims?.width,
      imageHeight: dims?.height,
    });

    if (result.normX === null || result.normY === null) {
      return NextResponse.json(
        {
          x: null,
          y: null,
          normX: null,
          normY: null,
          rawResponse: result.rawResponse,
          confidence: 0,
          boxHalf: BOX_HALF,
          message: "Model reported <none/>",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      x: result.x,
      y: result.y,
      normX: result.normX,
      normY: result.normY,
      boxHalf: BOX_HALF,
      rawResponse: result.rawResponse,
      confidence: result.confidence,
      imageWidth: dims?.width ?? null,
      imageHeight: dims?.height ?? null,
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
