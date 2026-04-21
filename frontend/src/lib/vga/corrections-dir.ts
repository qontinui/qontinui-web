/**
 * Filesystem layout + paths for the VGA correction log.
 *
 * Mirrors `qontinui/src/qontinui/vga/correction_log.py`:
 *   - Directory: $QONTINUI_VGA_CORRECTIONS_DIR, else <repo>/datasets/vga-corrections
 *   - JSONL file: <dir>/corrections.jsonl
 *   - Image files: <dir>/images/<sha256>.png
 *   - Private marker: sibling "<image_path>.private" touch file
 *
 * We must resolve the repo root relative to process.cwd() — in the
 * Next.js dev server cwd is qontinui-web/frontend, in production the
 * container cwd may differ. When the env var is unset we compute the
 * repo root by walking up until we find the sibling "datasets" dir.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const ENV_OVERRIDE = "QONTINUI_VGA_CORRECTIONS_DIR";
const DEFAULT_REL = path.join("datasets", "vga-corrections");

export function correctionsDir(): string {
  const override = process.env[ENV_OVERRIDE];
  if (override && override.length > 0) {
    const abs = path.resolve(override);
    ensureDir(abs);
    return abs;
  }

  // Walk up from cwd looking for a sibling `datasets` dir. Cap the
  // walk at 6 levels so we don't traverse the whole filesystem when
  // running outside a checkout.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "datasets");
    if (existsSync(candidate)) {
      const final = path.join(candidate, "vga-corrections");
      ensureDir(final);
      return final;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fall back to a path relative to cwd (creates it on first write).
  const fallback = path.resolve(process.cwd(), DEFAULT_REL);
  ensureDir(fallback);
  return fallback;
}

export function jsonlPath(dir: string = correctionsDir()): string {
  return path.join(dir, "corrections.jsonl");
}

export function imageDir(dir: string = correctionsDir()): string {
  const d = path.join(dir, "images");
  ensureDir(d);
  return d;
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}
