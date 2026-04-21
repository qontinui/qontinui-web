/**
 * Browser-side helpers for calling the /api/vga/* endpoints. Keeps the
 * builder client components small and centralizes fetch/JSON error
 * handling in one place.
 */

import type {
  VgaCanonicalExport,
  VgaProposal,
  VgaRunRow,
  VgaStateMachineGraph,
  VgaStateMachineRow,
  VgaStateMachineSummary,
} from "@/lib/types/vga";

async function handleJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = "";
    try {
      const body = (await resp.json()) as { error?: string; detail?: string };
      detail = body.error ?? body.detail ?? "";
    } catch {
      detail = await resp.text().catch(() => "");
    }
    throw new Error(
      `${resp.status} ${resp.statusText}${detail ? `: ${detail}` : ""}`
    );
  }
  return (await resp.json()) as T;
}

export async function listStateMachines(): Promise<VgaStateMachineSummary[]> {
  const resp = await fetch("/api/vga/state", { cache: "no-store" });
  const body = await handleJson<{ stateMachines: VgaStateMachineSummary[] }>(
    resp
  );
  return body.stateMachines;
}

export async function getStateMachine(id: string): Promise<VgaStateMachineRow> {
  const resp = await fetch(`/api/vga/state/${id}`, { cache: "no-store" });
  return handleJson<VgaStateMachineRow>(resp);
}

export async function createStateMachine(input: {
  name: string;
  targetProcess: string;
  targetOs: string;
  groundingModel: string;
  private: boolean;
  stateGraph?: VgaStateMachineGraph;
}): Promise<VgaStateMachineRow> {
  const resp = await fetch("/api/vga/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      stateGraph: input.stateGraph ?? { states: [], transitions: [] },
    }),
  });
  return handleJson<VgaStateMachineRow>(resp);
}

export async function patchStateMachine(
  id: string,
  patch: {
    name?: string;
    stateGraph?: VgaStateMachineGraph;
    groundingModel?: string;
    private?: boolean;
  }
): Promise<VgaStateMachineRow> {
  const resp = await fetch(`/api/vga/state/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handleJson<VgaStateMachineRow>(resp);
}

export async function deleteStateMachine(id: string): Promise<void> {
  const resp = await fetch(`/api/vga/state/${id}`, { method: "DELETE" });
  await handleJson<{ deleted: string }>(resp);
}

export async function importStateMachine(
  canonical: VgaCanonicalExport,
  nameOverride?: string
): Promise<VgaStateMachineRow> {
  const resp = await fetch("/api/vga/state/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      canonical,
      ...(nameOverride ? { name: nameOverride } : {}),
    }),
  });
  return handleJson<VgaStateMachineRow>(resp);
}

export async function listMonitors(): Promise<
  Array<{ id: number; name?: string; width: number; height: number }>
> {
  const resp = await fetch("/api/vga/monitors", { cache: "no-store" });
  // Runner shape: { monitors: [...] } — tolerate either shape.
  const body = (await handleJson<unknown>(resp)) as
    | {
        monitors?: Array<{
          id: number;
          name?: string;
          width: number;
          height: number;
        }>;
      }
    | Array<{ id: number; name?: string; width: number; height: number }>;
  if (Array.isArray(body)) return body;
  return body.monitors ?? [];
}

export async function captureScreenshot(monitor: number): Promise<Blob> {
  const resp = await fetch(`/api/vga/capture?monitor=${monitor}`, {
    cache: "no-store",
  });
  if (!resp.ok) {
    throw new Error(`Capture failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.blob();
}

/**
 * Optional shadow-sample context for the grounding endpoints. When both
 * are provided AND the referenced SM isn't private, each grounding call
 * writes a row into ``runner.vga_shadow_samples``. The builder page
 * passes these through from the loaded SM so the v6 training gate sees
 * production-distribution data.
 */
export interface ShadowContext {
  stateMachineId?: string;
  targetProcess?: string;
}

export async function proposeElements(
  imageBase64: string,
  shadow: ShadowContext = {}
): Promise<VgaProposal[]> {
  const resp = await fetch("/api/vga/propose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64,
      ...(shadow.stateMachineId
        ? { stateMachineId: shadow.stateMachineId }
        : {}),
      ...(shadow.targetProcess ? { targetProcess: shadow.targetProcess } : {}),
    }),
  });
  const body = await handleJson<{ proposals: VgaProposal[] }>(resp);
  return body.proposals;
}

export async function groundOnce(
  imageBase64: string,
  prompt: string,
  shadow: ShadowContext = {}
): Promise<{
  x: number | null;
  y: number | null;
  boxHalf: number;
  confidence: number;
  rawResponse?: string;
}> {
  const resp = await fetch("/api/vga/ground", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64,
      prompt,
      ...(shadow.stateMachineId
        ? { stateMachineId: shadow.stateMachineId }
        : {}),
      ...(shadow.targetProcess ? { targetProcess: shadow.targetProcess } : {}),
    }),
  });
  return handleJson(resp);
}

export async function submitCorrection(input: {
  stateMachineId: string;
  imageBase64: string;
  prompt: string;
  correctedBbox: { x: number; y: number; w: number; h: number };
  source: "builder" | "runtime";
}): Promise<{ imageSha: string; imagePath: string; private: boolean }> {
  const resp = await fetch("/api/vga/correction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(resp);
}

export async function getRun(runId: string): Promise<VgaRunRow> {
  const resp = await fetch(`/api/vga/runs/${runId}`, { cache: "no-store" });
  return handleJson<VgaRunRow>(resp);
}

/** Convert a Blob to the base64 payload required by /propose, /ground, /correction. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(binary);
  }
  // Server fallback — Next server components don't run this path today
  // but keep it defensive.
  return Buffer.from(bytes).toString("base64");
}
