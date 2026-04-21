/**
 * VGA shared TypeScript types.
 *
 * These mirror the Pydantic models in
 * `qontinui/src/qontinui/vga/state_machine.py` and the PG columns on
 * `runner.vga_state_machines` / `runner.vga_runs`. The canonical JSON
 * export (GET /api/vga/state/[id].json) serializes the state graph with
 * stable key ordering and no timestamps so the resulting string hashes
 * identically to `VgaStateMachine.sha256()` on the Python side.
 */

/** Axis-aligned bounding box in pixel coordinates. */
export interface VgaBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A persisted element inside a VGA state. */
export interface VgaElementGraph {
  id: string;
  label: string;
  prompt: string;
  bbox: VgaBBox;
  /** ISO-8601 timestamp; absent in canonical export. */
  last_confirmed_at?: string;
  /** Integer count of user corrections; absent in canonical export. */
  correction_count?: number;
}

/** A persisted state (node) in the VGA state graph. */
export interface VgaStateGraphNode {
  id: string;
  name: string;
  elements: VgaElementGraph[];
  /**
   * Mirrors `State.blocking` — when true, VGA runtime treats this as a
   * modal and pushes it into EnhancedActiveStateSet's blocking_states.
   */
  blocking: boolean;
}

/** Directed edge between two VGA states. */
export interface VgaTransitionGraph {
  id: string;
  from_state_id: string;
  to_state_id: string;
  trigger_element_id: string;
}

/**
 * JSONB shape persisted in `runner.vga_state_machines.state_graph`.
 *
 * NOTE: this is the *graph payload only* — the top-level SM fields
 * (name, target_process, target_os, grounding_model, private) are
 * columns on the row, not inside the JSONB.
 */
export interface VgaStateMachineGraph {
  states: VgaStateGraphNode[];
  transitions: VgaTransitionGraph[];
}

/** Full row returned by GET /api/vga/state/[id]. */
export interface VgaStateMachineRow {
  id: string;
  name: string;
  targetProcess: string;
  targetOs: string;
  groundingModel: string;
  private: boolean;
  stateGraph: VgaStateMachineGraph;
  v5Proposed: number;
  v5Confirmed: number;
  v5Corrected: number;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Summary shape returned by GET /api/vga/state. */
export interface VgaStateMachineSummary {
  id: string;
  name: string;
  targetProcess: string;
  targetOs: string;
  groundingModel: string;
  private: boolean;
  updatedAt: string;
  elementCount: number;
}

/**
 * Canonical export shape for GET /api/vga/state/[id].json and the body
 * accepted by POST /api/vga/state/import.
 *
 * Must round-trip losslessly with `VgaStateMachine.to_canonical_json` /
 * `VgaStateMachine.from_canonical_json` on the Python side. Python uses
 * snake_case field names — we mirror that here.
 *
 * Sorting rule for canonical serialization: every JSON object's keys
 * are sorted alphabetically, top-level and recursively. Timestamps
 * (`created_at`, `updated_at`, `last_confirmed_at`) and per-element
 * `correction_count` are stripped before sorting, matching the Python
 * implementation's `_CANONICAL_EXCLUDE` semantics.
 */
export interface VgaCanonicalExport {
  id?: string;
  name: string;
  target_process: string;
  target_os: string;
  grounding_model: string;
  private: boolean;
  states: VgaStateGraphNode[];
  transitions: VgaTransitionGraph[];
}

/** Proposal returned by POST /api/vga/propose. */
export interface VgaProposal {
  label: string;
  prompt: string;
  x: number;
  y: number;
  confidence: number;
  category: string;
}

/** Body for POST /api/vga/correction. */
export interface VgaCorrectionRequest {
  stateMachineId: string;
  imageBase64: string;
  prompt: string;
  correctedBbox: VgaBBox;
  source: "builder" | "runtime";
}

/**
 * One runtime step event, mirrors `VgaStepEvent` in
 * `qontinui/src/qontinui/vga/runtime.py`. Persisted into
 * `runner.vga_runs.step_log` (JSONB array) by the Rust step handler as
 * each line is parsed off the Python worker's stdout.
 */
export interface VgaStepEvent {
  kind: "vga.step";
  action: {
    kind: "click" | "type" | "wait_for";
    element_id?: string | null;
    text?: string | null;
    timeout_ms?: number;
  };
  prompt: string;
  bbox_pred?: VgaBBox | null;
  bbox_last?: VgaBBox | null;
  iou: number;
  template_similarity: number;
  status: "ok" | "drift" | "failed";
  error?: string | null;
  /** Optional runner-added screenshot URL for the run-inspection UI. */
  screenshot_url?: string | null;
  /** Optional runner-added timestamp for the step. */
  ts?: string;
}

/** Row returned by GET /api/vga/runs/[runId]. */
export interface VgaRunRow {
  id: string;
  stateMachineId: string;
  stateMachineName: string | null;
  taskRunId: string | null;
  groundingModel: string;
  status: string;
  stepLog: VgaStepEvent[];
  startedAt: string;
  endedAt: string | null;
}
