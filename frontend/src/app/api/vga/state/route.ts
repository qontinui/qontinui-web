/**
 * /api/vga/state
 *
 * - POST: create a new VGA state machine row.
 * - GET:  list state machines (optional ?targetProcess= filter).
 */

import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";
import type {
  VgaStateMachineGraph,
  VgaStateMachineRow,
  VgaStateMachineSummary,
} from "@/lib/types/vga";
import { buildCanonicalExport, canonicalJsonString } from "@/lib/vga/canonical";
import { createStateRequestSchema } from "@/lib/vga/schemas";
import { createHash } from "node:crypto";

interface StateMachineDbRow {
  id: string;
  name: string;
  target_process: string;
  target_os: string;
  grounding_model: string;
  private: boolean;
  state_graph: VgaStateMachineGraph;
  v5_proposed: number;
  v5_confirmed: number;
  v5_corrected: number;
  content_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToApi(row: StateMachineDbRow): VgaStateMachineRow {
  return {
    id: row.id,
    name: row.name,
    targetProcess: row.target_process,
    targetOs: row.target_os,
    groundingModel: row.grounding_model,
    private: row.private,
    stateGraph: row.state_graph,
    v5Proposed: row.v5_proposed,
    v5Confirmed: row.v5_confirmed,
    v5Corrected: row.v5_corrected,
    contentHash: row.content_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createStateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const groundingModel = parsed.data.groundingModel ?? "qontinui-grounding-v5";
  const isPrivate = parsed.data.private ?? true;

  const canonical = buildCanonicalExport({
    id,
    name: parsed.data.name,
    targetProcess: parsed.data.targetProcess,
    targetOs: parsed.data.targetOs,
    groundingModel,
    private: isPrivate,
    stateGraph: parsed.data.stateGraph,
  });
  const contentHash = createHash("sha256")
    .update(canonicalJsonString(canonical))
    .digest("hex");

  try {
    const { rows } = await vgaQuery<StateMachineDbRow>(
      `INSERT INTO vga_state_machines
         (id, name, target_process, target_os, grounding_model, private,
          state_graph, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [
        id,
        parsed.data.name,
        parsed.data.targetProcess,
        parsed.data.targetOs,
        groundingModel,
        isPrivate,
        JSON.stringify(parsed.data.stateGraph),
        contentHash,
      ]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Insert returned no row" },
        { status: 500 }
      );
    }
    return NextResponse.json(rowToApi(rows[0] as StateMachineDbRow), {
      status: 201,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const targetProcess = request.nextUrl.searchParams.get("targetProcess");

  try {
    const { rows } = await vgaQuery<
      Pick<
        StateMachineDbRow,
        | "id"
        | "name"
        | "target_process"
        | "target_os"
        | "grounding_model"
        | "private"
        | "updated_at"
        | "state_graph"
      >
    >(
      targetProcess
        ? `SELECT id, name, target_process, target_os, grounding_model, private,
                  updated_at, state_graph
             FROM vga_state_machines
            WHERE target_process = $1
            ORDER BY updated_at DESC`
        : `SELECT id, name, target_process, target_os, grounding_model, private,
                  updated_at, state_graph
             FROM vga_state_machines
            ORDER BY updated_at DESC`,
      targetProcess ? [targetProcess] : []
    );

    const stateMachines: VgaStateMachineSummary[] = rows.map((r) => {
      const graph = r.state_graph;
      const elementCount = (graph.states ?? []).reduce(
        (acc, s) => acc + (s.elements?.length ?? 0),
        0
      );
      return {
        id: r.id,
        name: r.name,
        targetProcess: r.target_process,
        targetOs: r.target_os,
        groundingModel: r.grounding_model,
        private: r.private,
        updatedAt: r.updated_at.toISOString(),
        elementCount,
      };
    });

    return NextResponse.json({ stateMachines });
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
