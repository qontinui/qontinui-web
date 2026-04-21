/**
 * POST /api/vga/ground
 *
 * Thin server-side proxy to the llama-swap OpenAI-compat endpoint.
 * Browser code never sees the model URL directly so we can swap v5/v6
 * out without touching the web client.
 */

import { after, NextResponse, type NextRequest } from "next/server";

import {
  GroundingParseError,
  GroundingUnavailableError,
  groundOnce,
} from "@/lib/vga/grounding-client";
import { readImageDims } from "@/lib/vga/image-dims";
import { groundRequestSchema } from "@/lib/vga/schemas";
import { logShadowSample } from "@/lib/vga/shadow-log";

/** Half-edge of the bbox we return around the predicted point. */
const BOX_HALF = 20;

/** Default grounding model string recorded on shadow samples. */
const DEFAULT_MODEL = "qontinui-grounding-v5";

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

    // Fire-and-forget shadow-sample write. Must not block the response
    // path — the user's grounding result takes priority over this log
    // side effect (see :mod:`qontinui.vga.shadow_log` for the mirror
    // contract on the Python runtime side).
    //
    // We use Next.js's ``after()`` rather than a raw unawaited promise:
    // route handlers don't keep unawaited promises alive after the
    // response is sent (the lambda/edge lifecycle model), so a raw
    // ``void logShadowSample(...)`` silently drops the write in
    // practice. ``after()`` is Next 15's supported hook for
    // post-response side effects.
    if (result.x !== null && result.y !== null) {
      const x = result.x;
      const y = result.y;
      const imageBase64 = parsed.data.imageBase64;
      const promptValue = parsed.data.prompt;
      const modelUsed = parsed.data.model ?? DEFAULT_MODEL;
      const { confidence } = result;
      const stateMachineId = parsed.data.stateMachineId;
      const targetProcess = parsed.data.targetProcess;
      after(async () => {
        await logShadowSample({
          imageBase64,
          prompt: promptValue,
          predictedBbox: {
            x: Math.max(0, x - BOX_HALF),
            y: Math.max(0, y - BOX_HALF),
            w: BOX_HALF * 2,
            h: BOX_HALF * 2,
          },
          modelUsed,
          confidence,
          stateMachineId,
          targetProcess,
        });
      });
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
