/**
 * GET /api/vga/runs/[runId]
 *
 * Returns a single VGA run row from `runner.vga_runs`. Joins to
 * `runner.vga_state_machines` for the SM name so the inspection UI
 * can link back without a second round-trip.
 */

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";
import type { VgaRunRow, VgaStepEvent } from "@/lib/types/vga";

interface RunDbRow {
  id: string;
  state_machine_id: string;
  state_machine_name: string | null;
  task_run_id: string | null;
  grounding_model: string;
  status: string;
  step_log: VgaStepEvent[];
  started_at: Date;
  ended_at: Date | null;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  if (!isValidUuid(runId)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }

  try {
    const { rows } = await vgaQuery<RunDbRow>(
      `SELECT r.id, r.state_machine_id, s.name AS state_machine_name,
              r.task_run_id, r.grounding_model, r.status,
              r.step_log, r.started_at, r.ended_at
         FROM vga_runs r
         LEFT JOIN vga_state_machines s ON s.id = r.state_machine_id
        WHERE r.id = $1`,
      [runId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const row = rows[0] as RunDbRow;

    const api: VgaRunRow = {
      id: row.id,
      stateMachineId: row.state_machine_id,
      stateMachineName: row.state_machine_name,
      taskRunId: row.task_run_id,
      groundingModel: row.grounding_model,
      status: row.status,
      stepLog: Array.isArray(row.step_log) ? row.step_log : [],
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    };
    return NextResponse.json(api);
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
