/**
 * GET /api/vga/state/[id]/export  (public URL: /api/vga/state/[id].json)
 *
 * Canonical JSON export: stable key ordering, no timestamps, content-
 * addressable. Matches `VgaStateMachine.to_canonical_json()` on the
 * Python side byte-for-byte so the SHA-256 of the response body equals
 * what `VgaStateMachine.sha256()` would compute. See
 * `src/lib/vga/canonical.ts` for the sorting / stripping rules.
 *
 * The public-facing `.json` URL is wired through a rewrite in
 * `next.config.mjs` because Next.js App Router doesn't accept `.json`
 * as part of a `[...]` dynamic segment.
 */

import { NextResponse, type NextRequest } from "next/server";

import { vgaQuery } from "@/lib/db/vga";
import type { VgaStateMachineGraph } from "@/lib/types/vga";
import { buildCanonicalExport, canonicalJsonString } from "@/lib/vga/canonical";

interface StateMachineDbRow {
  id: string;
  name: string;
  target_process: string;
  target_os: string;
  grounding_model: string;
  private: boolean;
  state_graph: VgaStateMachineGraph;
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
      `SELECT id, name, target_process, target_os, grounding_model, private,
              state_graph
         FROM vga_state_machines
        WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const row = rows[0] as StateMachineDbRow;

    const canonical = buildCanonicalExport({
      id: row.id,
      name: row.name,
      targetProcess: row.target_process,
      targetOs: row.target_os,
      groundingModel: row.grounding_model,
      private: row.private,
      stateGraph: row.state_graph,
    });
    const body = canonicalJsonString(canonical);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
