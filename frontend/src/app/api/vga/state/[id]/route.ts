/**
 * /api/vga/state/[id]
 *
 * - GET:    return the full row.
 * - PATCH:  update name / stateGraph / groundingModel / private.
 * - DELETE: hard-delete by ID (ON DELETE CASCADE removes child rows).
 */

import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";
import type { VgaStateMachineGraph, VgaStateMachineRow } from "@/lib/types/vga";
import { buildCanonicalExport, canonicalJsonString } from "@/lib/vga/canonical";
import { patchStateRequestSchema } from "@/lib/vga/schemas";

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

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json(
      { error: "Invalid state machine ID" },
      { status: 400 }
    );
  }
  try {
    const { rows } = await vgaQuery<StateMachineDbRow>(
      `SELECT * FROM vga_state_machines WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToApi(rows[0] as StateMachineDbRow));
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json(
      { error: "Invalid state machine ID" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchStateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    // Fetch current row so we can compute a fresh content_hash when
    // any hashable field changes.
    const { rows: current } = await vgaQuery<StateMachineDbRow>(
      `SELECT * FROM vga_state_machines WHERE id = $1`,
      [id]
    );
    if (current.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const existing = current[0] as StateMachineDbRow;

    const nextName = parsed.data.name ?? existing.name;
    const nextGraph = parsed.data.stateGraph ?? existing.state_graph;
    const nextModel = parsed.data.groundingModel ?? existing.grounding_model;
    const nextPrivate = parsed.data.private ?? existing.private;

    const canonical = buildCanonicalExport({
      id: existing.id,
      name: nextName,
      targetProcess: existing.target_process,
      targetOs: existing.target_os,
      groundingModel: nextModel,
      private: nextPrivate,
      stateGraph: nextGraph,
    });
    const contentHash = createHash("sha256")
      .update(canonicalJsonString(canonical))
      .digest("hex");

    const { rows } = await vgaQuery<StateMachineDbRow>(
      `UPDATE vga_state_machines
          SET name = $2,
              state_graph = $3::jsonb,
              grounding_model = $4,
              private = $5,
              content_hash = $6,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        nextName,
        JSON.stringify(nextGraph),
        nextModel,
        nextPrivate,
        contentHash,
      ]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rowToApi(rows[0] as StateMachineDbRow));
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json(
      { error: "Invalid state machine ID" },
      { status: 400 }
    );
  }
  try {
    const { rowCount } = await vgaQuery(
      `DELETE FROM vga_state_machines WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: id });
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
