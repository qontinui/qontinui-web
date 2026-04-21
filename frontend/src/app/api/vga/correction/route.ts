/**
 * POST /api/vga/correction
 *
 * Appends one correction line to
 *   <corrections-dir>/corrections.jsonl
 * and writes the referenced screenshot to
 *   <corrections-dir>/images/<sha256>.png
 *
 * Also increments `v5_corrected` on the linked state machine row.
 *
 * Privacy: when the state machine's `private` column is true, we also
 * touch a "<image_path>.private" sidecar so a future corrections
 * exporter can filter private entries without re-querying PG.
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";
import {
  correctionsDir,
  imageDir as getImageDir,
  jsonlPath as getJsonlPath,
} from "@/lib/vga/corrections-dir";
import { correctionRequestSchema } from "@/lib/vga/schemas";

interface SmLookupRow {
  target_process: string;
  private: boolean;
}

function decodeBase64Image(b64: string): Buffer {
  const stripped = b64.startsWith("data:")
    ? b64.replace(/^data:image\/[a-z0-9+.-]+;base64,/i, "")
    : b64;
  return Buffer.from(stripped, "base64");
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = correctionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  let smInfo: SmLookupRow;
  try {
    const { rows } = await vgaQuery<SmLookupRow>(
      `SELECT target_process, private
         FROM vga_state_machines
        WHERE id = $1`,
      [parsed.data.stateMachineId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Unknown stateMachineId" },
        { status: 404 }
      );
    }
    smInfo = rows[0] as SmLookupRow;
  } catch (err) {
    return NextResponse.json(
      { error: "Database lookup failed", detail: (err as Error).message },
      { status: 500 }
    );
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = decodeBase64Image(parsed.data.imageBase64);
    if (imageBuffer.length === 0) throw new Error("empty image buffer");
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid imageBase64", detail: (err as Error).message },
      { status: 400 }
    );
  }

  const imageSha = createHash("sha256").update(imageBuffer).digest("hex");
  const dir = correctionsDir();
  const imagePath = path.join(getImageDir(dir), `${imageSha}.png`);

  try {
    writeFileSync(imagePath, imageBuffer);
  } catch (err) {
    return NextResponse.json(
      { error: "Could not write image", detail: (err as Error).message },
      { status: 500 }
    );
  }

  if (smInfo.private) {
    // Match Python correction_log.py: empty marker file next to image.
    try {
      const fd = openSync(`${imagePath}.private`, "a");
      closeSync(fd);
    } catch {
      // non-fatal — exporter will still see private=true in the JSONL.
    }
  }

  const entry = {
    corrected_bbox: {
      x: parsed.data.correctedBbox.x,
      y: parsed.data.correctedBbox.y,
      w: parsed.data.correctedBbox.w,
      h: parsed.data.correctedBbox.h,
    },
    image_path: imagePath,
    image_sha: imageSha,
    private: smInfo.private,
    prompt: parsed.data.prompt,
    source: parsed.data.source,
    state_machine_id: parsed.data.stateMachineId,
    target_process: smInfo.target_process,
    ts: new Date().toISOString(),
  };
  const line = `${stableStringify(entry)}\n`;

  try {
    await appendFile(getJsonlPath(dir), line, "utf-8");
  } catch (err) {
    return NextResponse.json(
      { error: "Could not append to JSONL", detail: (err as Error).message },
      { status: 500 }
    );
  }

  // Bump correction counter — best-effort, don't fail the whole call if
  // the UPDATE fails (the correction file is already durable on disk).
  try {
    await vgaQuery(
      `UPDATE vga_state_machines
          SET v5_corrected = v5_corrected + 1,
              updated_at = NOW()
        WHERE id = $1`,
      [parsed.data.stateMachineId]
    );
  } catch (err) {
    console.error("[vga-correction] failed to bump counter:", err);
  }

  return NextResponse.json(
    {
      imageSha,
      imagePath,
      jsonlPath: getJsonlPath(dir),
      private: smInfo.private,
    },
    { status: 201 }
  );
}

/** Stable-sort-key JSON encoder so log lines diff cleanly across runs. */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(",")}]`;
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      parts.push(`${JSON.stringify(key)}:${stableStringify(record[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(obj);
}
