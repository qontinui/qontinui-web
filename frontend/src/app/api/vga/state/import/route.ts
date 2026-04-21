/**
 * POST /api/vga/state/import
 *
 * Accepts a canonical JSON export (same shape as
 * GET /api/vga/state/[id].json) and creates a NEW row with a new UUID.
 * The `canonical` member is validated against the same schema as the
 * export and then reshaped into the DB's column + JSONB split.
 *
 * Body shape (JSON):
 *   {
 *     "name": "optional override",
 *     "canonical": {
 *       "id": "optional original UUID (discarded)",
 *       "name": "...",
 *       "target_process": "...",
 *       "target_os": "...",
 *       "grounding_model": "...",
 *       "private": true,
 *       "states": [...],
 *       "transitions": [...]
 *     }
 *   }
 *
 * Round-trips losslessly with the export endpoint.
 */

import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";
import type { VgaStateMachineGraph, VgaStateMachineRow } from "@/lib/types/vga";
import { buildCanonicalExport, canonicalJsonString } from "@/lib/vga/canonical";
import { importStateRequestSchema } from "@/lib/vga/schemas";

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

  const parsed = importStateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const newId = randomUUID();
  const finalName = parsed.data.name ?? parsed.data.canonical.name;
  const stateGraph: VgaStateMachineGraph = {
    states: parsed.data.canonical.states,
    transitions: parsed.data.canonical.transitions,
  };

  // Recompute hash under the NEW id — export/import is "losslessly" in
  // the sense that the state graph is preserved, but the SM id is
  // reassigned on import (plan: "Creates a NEW row (new UUID)").
  const canonical = buildCanonicalExport({
    id: newId,
    name: finalName,
    targetProcess: parsed.data.canonical.target_process,
    targetOs: parsed.data.canonical.target_os,
    groundingModel: parsed.data.canonical.grounding_model,
    private: parsed.data.canonical.private,
    stateGraph,
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
        newId,
        finalName,
        parsed.data.canonical.target_process,
        parsed.data.canonical.target_os,
        parsed.data.canonical.grounding_model,
        parsed.data.canonical.private,
        JSON.stringify(stateGraph),
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
