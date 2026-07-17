/**
 * Line diff for the prompt-document version history (plan
 * `2026-07-17-session-autonomy-fabric.md` Phase 9).
 *
 * Prompt documents are prose measured in kilobytes and both sides are already in
 * memory, so the diff is computed client-side — no round-trip, and no new
 * dependency for ~60 lines of well-understood algorithm (the repo ships no diff
 * library; the only existing "diff" surface, the collaboration
 * ConflictDiffItem, compares whole field VALUES and has no line-level engine to
 * reuse).
 *
 * Classic LCS dynamic programming over lines: O(n·m) time and memory, exact
 * (not a heuristic), and stable. A guard rail bails out to a whole-document
 * replacement above `MAX_LCS_CELLS`, so a pathological input degrades into a
 * coarser-but-honest diff rather than pinning the browser.
 */

/** One line of the rendered diff. */
export interface DiffLine {
  type: "context" | "added" | "removed";
  /** 1-based line number in the OLD document; null for an added line. */
  oldNumber: number | null;
  /** 1-based line number in the NEW document; null for a removed line. */
  newNumber: number | null;
  text: string;
}

/** Aggregate counts for the diff summary line. */
export interface DiffStats {
  added: number;
  removed: number;
  /** True when the two sides are byte-identical. */
  identical: boolean;
  /**
   * True when the inputs exceeded the LCS budget and the diff was degraded to a
   * whole-document replacement. The UI says so rather than implying the
   * documents share nothing.
   */
  truncated: boolean;
}

export interface DiffResult {
  lines: DiffLine[];
  stats: DiffStats;
}

/**
 * LCS table budget. 2000×2000 lines = 4M cells — comfortably instant, and far
 * beyond any real prompt document (the largest shipped default is a few hundred
 * lines).
 */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  // A trailing newline would otherwise yield a phantom empty last line.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized === "" ? [] : normalized.split("\n");
}

/** Whole-document replacement — the degraded shape for oversized inputs. */
function replaceAll(oldLines: string[], newLines: string[]): DiffResult {
  const lines: DiffLine[] = [
    ...oldLines.map((text, i) => ({
      type: "removed" as const,
      oldNumber: i + 1,
      newNumber: null,
      text,
    })),
    ...newLines.map((text, i) => ({
      type: "added" as const,
      oldNumber: null,
      newNumber: i + 1,
      text,
    })),
  ];
  return {
    lines,
    stats: {
      added: newLines.length,
      removed: oldLines.length,
      identical: false,
      truncated: true,
    },
  };
}

/**
 * Diff two document bodies line by line.
 *
 * @param oldText the earlier version's body (the diff's left side)
 * @param newText the later version's body (the diff's right side)
 */
export function diffLines(oldText: string, newText: string): DiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldText === newText) {
    return {
      lines: oldLines.map((text, i) => ({
        type: "context" as const,
        oldNumber: i + 1,
        newNumber: i + 1,
        text,
      })),
      stats: { added: 0, removed: 0, identical: true, truncated: false },
    };
  }

  const n = oldLines.length;
  const m = newLines.length;
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) return replaceAll(oldLines, newLines);

  // lcs(i, j) = length of the longest common subsequence of oldLines[i..] and
  // newLines[j..], held in a flat row-major Int32Array ((m + 1) per row) —
  // one allocation instead of n nested arrays. Filled backwards so the walk
  // below can move forwards.
  const stride = m + 1;
  const lcs = new Int32Array((n + 1) * stride);
  const at = (i: number, j: number): number => lcs[i * stride + j] as number;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * stride + j] =
        oldLines[i] === newLines[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[j] ?? "";
    if (oldLine === newLine) {
      lines.push({
        type: "context",
        oldNumber: i + 1,
        newNumber: j + 1,
        text: oldLine,
      });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      lines.push({
        type: "removed",
        oldNumber: i + 1,
        newNumber: null,
        text: oldLine,
      });
      removed++;
      i++;
    } else {
      lines.push({
        type: "added",
        oldNumber: null,
        newNumber: j + 1,
        text: newLine,
      });
      added++;
      j++;
    }
  }
  for (; i < n; i++) {
    lines.push({
      type: "removed",
      oldNumber: i + 1,
      newNumber: null,
      text: oldLines[i] ?? "",
    });
    removed++;
  }
  for (; j < m; j++) {
    lines.push({
      type: "added",
      oldNumber: null,
      newNumber: j + 1,
      text: newLines[j] ?? "",
    });
    added++;
  }

  return {
    lines,
    stats: { added, removed, identical: false, truncated: false },
  };
}
