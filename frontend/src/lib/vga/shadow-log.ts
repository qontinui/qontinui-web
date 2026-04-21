/**
 * Server-side helper for writing rows into ``runner.vga_shadow_samples``.
 *
 * Every production grounding call lands one row here so the VGA v6
 * training gate has production-distribution data to re-predict against.
 * Closes the gap called out in milestone (c) of the VGA plan §14 —
 * "shadow-eval log: table exists and the daemon queries it, but no code
 * currently WRITES to it".
 *
 * Design invariants (mirror :mod:`qontinui.vga.shadow_log`):
 *
 *  - **Fire-and-forget.** Every public function returns a promise but
 *    the callers deliberately don't await it in the critical path —
 *    the user's grounding result must never be blocked on the log
 *    write. Failures are logged to console and swallowed.
 *  - **Privacy-safe default.** If the state machine referenced by
 *    ``stateMachineId`` has ``private = true``, the row is skipped.
 *  - **Per-domain key = target_process.** For SM-less calls (builder
 *    wizard, one-off probes) the FK is null and the row is still
 *    bucketed by ``target_process``. If neither the SM nor the caller
 *    provides ``target_process``, the log is skipped entirely.
 *  - **Image dedupe.** The PNG is saved at
 *    ``<corrections-dir>/images/<sha256>.png`` via an atomic
 *    write-to-tmp-then-rename dance so two concurrent calls with the
 *    same sha don't corrupt each other. Existing files are left alone.
 */

import { createHash } from "node:crypto";
import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { vgaQuery } from "@/lib/db/vga";
import {
  correctionsDir,
  imageDir as getImageDir,
} from "@/lib/vga/corrections-dir";

export interface ShadowSampleInput {
  imageBase64: string;
  prompt: string;
  /** Centered on the predicted point; same shape the PATCH route uses. */
  predictedBbox: { x: number; y: number; w: number; h: number };
  /** Effective grounding model string (fallback: v5 default). */
  modelUsed: string;
  confidence: number | null;
  /** Optional FK into ``runner.vga_state_machines``. */
  stateMachineId?: string;
  /** Required for per-domain shadow eval. Fallback: SM's own target_process. */
  targetProcess?: string;
}

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

/**
 * Atomically write ``bytes`` to ``<dir>/images/<sha>.png`` — skip if it
 * already exists. Writes to a ``.tmp`` sibling first and renames, so two
 * concurrent writers with the same sha can't half-write each other.
 */
function writeImageIfNew(imagePath: string, bytes: Buffer): void {
  if (existsSync(imagePath)) return;
  const tmp = `${imagePath}.tmp`;
  writeFileSync(tmp, bytes);
  try {
    renameSync(tmp, imagePath);
  } catch {
    // Another writer won the race — clean up our tmp and move on.
    try {
      unlinkSync(tmp);
    } catch {
      // swallow — best-effort cleanup.
    }
  }
}

/**
 * Best-effort, fire-and-forget shadow-sample writer.
 *
 * Callers pattern (do NOT await in the response path):
 *
 * ```ts
 * void logShadowSample({...});
 * return NextResponse.json(result);
 * ```
 *
 * The explicit ``void`` (or a trailing ``.catch(...)``) stops TS + eslint
 * from complaining about an unhandled promise.
 */
export async function logShadowSample(input: ShadowSampleInput): Promise<void> {
  try {
    // 1. Resolve per-domain key + privacy flag.
    let targetProcess = input.targetProcess;
    let isPrivate = false;

    if (input.stateMachineId) {
      try {
        const { rows } = await vgaQuery<SmLookupRow>(
          `SELECT target_process, private
             FROM vga_state_machines
            WHERE id = $1`,
          [input.stateMachineId]
        );
        if (rows.length > 0) {
          const row = rows[0] as SmLookupRow;
          isPrivate = row.private;
          if (!targetProcess) targetProcess = row.target_process;
        }
      } catch (err) {
        console.error("[vga-shadow] sm lookup failed:", err);
      }
    }

    if (isPrivate) {
      // Private SMs never leak through the shadow channel — mirrors the
      // correction-log privacy contract.
      return;
    }
    if (!targetProcess) {
      // No per-domain bucket: skip rather than guess a sentinel. A
      // future caller providing a targetProcess will get logged fine.
      return;
    }

    // 2. Decode image + compute sha + save dedupe copy on disk.
    const imageBuffer = decodeBase64Image(input.imageBase64);
    if (imageBuffer.length === 0) return;
    const imageSha = createHash("sha256").update(imageBuffer).digest("hex");

    const dir = correctionsDir();
    const imagePath = path.join(getImageDir(dir), `${imageSha}.png`);
    try {
      writeImageIfNew(imagePath, imageBuffer);
    } catch (err) {
      console.error("[vga-shadow] image write failed:", err);
      // Keep going — we can still insert the row; the sha still lets
      // the v6 trainer look the image up from earlier writes.
    }

    // 3. Insert the row.
    await vgaQuery(
      `INSERT INTO vga_shadow_samples
         (state_machine_id, image_sha, image_path, prompt,
          target_process, predicted_bbox, model_used, confidence,
          created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW())`,
      [
        input.stateMachineId ?? null,
        imageSha,
        imagePath,
        input.prompt,
        targetProcess,
        JSON.stringify(input.predictedBbox),
        input.modelUsed,
        input.confidence,
      ]
    );
  } catch (err) {
    // Never let a shadow-log failure leak up — the grounding result
    // must not be blocked on this side effect.
    console.error("[vga-shadow] log failed:", err);
  }
}
