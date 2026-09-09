/**
 * Minimal line diff for the version-comparison view.
 *
 * Written locally rather than pulled in as a dependency: the repo ships no diff
 * library, and unit files are markdown (or shell) of a few hundred to a couple of
 * thousand lines — well inside what a plain LCS table handles. Adding a diff
 * package for one console page would be the heavier option.
 *
 * Guarded by `MAX_LCS_CELLS`: the LCS table is O(n·m), so for pathologically
 * large bodies we degrade to a positional comparison and say so, rather than
 * locking the tab up.
 */

export type DiffOp = "context" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  /** 1-based line number on the left (older) side, `null` for an addition. */
  leftNumber: number | null;
  /** 1-based line number on the right (newer) side, `null` for a removal. */
  rightNumber: number | null;
  text: string;
}

/** A collapsed run of unchanged lines, standing in for `count` hidden lines. */
export interface ElidedRun {
  elided: number;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the bodies are byte-identical. */
  identical: boolean;
  /** True when the LCS was skipped for size and a positional comparison was
   *  used instead — the result is still correct as a line-by-line comparison,
   *  just not minimal. Surfaced in the UI rather than hidden. */
  degraded: boolean;
}

/** ~4M cells ≈ a 2000×2000 line comparison. Above this we degrade. */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * In-bounds line read. `tsconfig` runs with `noUncheckedIndexedAccess`, and
 * every call site below is provably in range, so an empty-string fallback is
 * the honest way to say "cannot happen" without a non-null assertion.
 */
function lineAt(lines: string[], index: number): string {
  return lines[index] ?? "";
}

/** LCS table read. Out of range means "no common suffix left", i.e. 0. */
function cellAt(table: number[][], i: number, j: number): number {
  return table[i]?.[j] ?? 0;
}

/** Positional fallback: compare line i to line i, no alignment. */
function positionalDiff(left: string[], right: string[]): DiffLine[] {
  const lines: DiffLine[] = [];
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    const l = left[i];
    const r = right[i];
    if (l !== undefined && r !== undefined && l === r) {
      lines.push({
        op: "context",
        leftNumber: i + 1,
        rightNumber: i + 1,
        text: l,
      });
      continue;
    }
    if (l !== undefined) {
      lines.push({
        op: "remove",
        leftNumber: i + 1,
        rightNumber: null,
        text: l,
      });
    }
    if (r !== undefined) {
      lines.push({ op: "add", leftNumber: null, rightNumber: i + 1, text: r });
    }
  }
  return lines;
}

function lcsDiff(left: string[], right: string[]): DiffLine[] {
  const n = left.length;
  const m = right.length;

  // table[i][j] = LCS length of left[i..] and right[j..]
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i];
    if (!row) continue;
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        lineAt(left, i) === lineAt(right, j)
          ? cellAt(table, i + 1, j + 1) + 1
          : Math.max(cellAt(table, i + 1, j), cellAt(table, i, j + 1));
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (lineAt(left, i) === lineAt(right, j)) {
      lines.push({
        op: "context",
        leftNumber: i + 1,
        rightNumber: j + 1,
        text: lineAt(left, i),
      });
      i++;
      j++;
    } else if (cellAt(table, i + 1, j) >= cellAt(table, i, j + 1)) {
      lines.push({
        op: "remove",
        leftNumber: i + 1,
        rightNumber: null,
        text: lineAt(left, i),
      });
      i++;
    } else {
      lines.push({
        op: "add",
        leftNumber: null,
        rightNumber: j + 1,
        text: lineAt(right, j),
      });
      j++;
    }
  }
  while (i < n) {
    lines.push({
      op: "remove",
      leftNumber: i + 1,
      rightNumber: null,
      text: lineAt(left, i),
    });
    i++;
  }
  while (j < m) {
    lines.push({
      op: "add",
      leftNumber: null,
      rightNumber: j + 1,
      text: lineAt(right, j),
    });
    j++;
  }
  return lines;
}

/** Diff `leftBody` (older) against `rightBody` (newer), line by line. */
export function computeLineDiff(
  leftBody: string,
  rightBody: string
): DiffResult {
  const left = splitLines(leftBody);
  const right = splitLines(rightBody);

  const degraded = (left.length + 1) * (right.length + 1) > MAX_LCS_CELLS;
  const lines = degraded ? positionalDiff(left, right) : lcsDiff(left, right);

  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === "add") added++;
    else if (line.op === "remove") removed++;
  }

  return {
    lines,
    added,
    removed,
    identical: leftBody === rightBody,
    degraded,
  };
}

/**
 * Collapse long runs of unchanged lines, keeping `context` lines of padding
 * around every change. Returns the kept lines interleaved with `ElidedRun`
 * markers standing for a hidden run.
 */
export function collapseContext(
  lines: DiffLine[],
  context = 3
): (DiffLine | ElidedRun)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.op === "context") return;
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let j = from; j <= to; j++) {
      keep[j] = true;
    }
  });

  const out: (DiffLine | ElidedRun)[] = [];
  let run = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (run > 0) {
        out.push({ elided: run });
        run = 0;
      }
      out.push(line);
    } else {
      run++;
    }
  });
  if (run > 0) out.push({ elided: run });
  return out;
}
