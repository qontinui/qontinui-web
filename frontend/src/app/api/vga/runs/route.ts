/**
 * GET /api/vga/runs
 *
 * Paginated, filterable list of VGA runs joined to their owning state
 * machine for the runs-index UI (/vga/runs).
 *
 * Query params:
 *   status          — one of "running" | "succeeded" | "failed" | "drifted"
 *   target_process  — exact-match on sm.target_process
 *   since           — ISO-8601; r.started_at >= since
 *   until           — ISO-8601; r.started_at <= until
 *   limit           — default 50, capped at 200
 *   offset          — default 0
 *
 * Response: `{ runs: VgaRunListItem[], total: number }` where `total` is
 * the count before limit/offset (computed via a single COUNT(*) OVER()
 * window in the same query).
 */

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";

export interface VgaRunListItem {
  id: string;
  stateMachineId: string;
  stateMachineName: string | null;
  targetProcess: string | null;
  groundingModel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

interface RunListDbRow {
  id: string;
  state_machine_id: string;
  state_machine_name: string | null;
  target_process: string | null;
  grounding_model: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  total_count: string; // COUNT(*) OVER() returns bigint → string in pg
}

const ALLOWED_STATUSES = new Set(["running", "succeeded", "failed", "drifted"]);

function isValidIso(value: string): boolean {
  const t = Date.parse(value);
  return Number.isFinite(t);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const status = sp.get("status");
  const targetProcess = sp.get("target_process");
  const since = sp.get("since");
  const until = sp.get("until");
  const rawLimit = sp.get("limit");
  const rawOffset = sp.get("offset");

  if (status && !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(", ")}` },
      { status: 400 }
    );
  }
  if (since && !isValidIso(since)) {
    return NextResponse.json(
      { error: "Invalid `since` — must be ISO-8601" },
      { status: 400 }
    );
  }
  if (until && !isValidIso(until)) {
    return NextResponse.json(
      { error: "Invalid `until` — must be ISO-8601" },
      { status: 400 }
    );
  }

  let limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  let offset = rawOffset ? Number.parseInt(rawOffset, 10) : 0;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  // Build WHERE with parameterized placeholders.
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("$?", `$${params.length}`));
  };

  if (status) push("r.status = $?", status);
  if (targetProcess) push("sm.target_process = $?", targetProcess);
  if (since) push("r.started_at >= $?", since);
  if (until) push("r.started_at <= $?", until);

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  // Push limit + offset at the end so their placeholders come last.
  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const sql = `
    SELECT r.id,
           r.state_machine_id,
           sm.name           AS state_machine_name,
           sm.target_process AS target_process,
           r.grounding_model,
           r.status,
           r.started_at,
           r.ended_at,
           COUNT(*) OVER()   AS total_count
      FROM vga_runs r
      LEFT JOIN vga_state_machines sm ON sm.id = r.state_machine_id
      ${whereSql}
      ORDER BY r.started_at DESC
      LIMIT ${limitPlaceholder}
      OFFSET ${offsetPlaceholder}
  `;

  try {
    const { rows } = await vgaQuery<RunListDbRow>(sql, params);

    const runs: VgaRunListItem[] = rows.map((row) => ({
      id: row.id,
      stateMachineId: row.state_machine_id,
      stateMachineName: row.state_machine_name,
      targetProcess: row.target_process,
      groundingModel: row.grounding_model,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    }));

    const total =
      rows.length > 0 ? Number.parseInt(rows[0]!.total_count, 10) : 0;

    return NextResponse.json({ runs, total });
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
