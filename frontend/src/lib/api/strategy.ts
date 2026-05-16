/**
 * Strategy Collaboration API (Phase 1, read-only).
 *
 * Proxies to the backend `/api/v1/strategy/*`, which forwards to
 * qontinui-coord behind the service-account bridge. Cookie auth
 * (relative fetch) — same pattern as the other domain api modules.
 * Threads/posts are Phase 2 and intentionally absent.
 */

export interface StrategyProvenance {
  commit_sha: string;
  committed_at: string;
  author: string;
}

export interface StrategyDocSummary {
  name: string;
  title: string;
  provenance: StrategyProvenance;
}

export interface StrategyDoc extends StrategyDocSummary {
  content: string;
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body.detail || body.error || detail;
    } catch {
      /* non-JSON body — keep the status-based message */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function listStrategyDocs(): Promise<StrategyDocSummary[]> {
  const res = await fetch("/api/v1/strategy/docs", {
    credentials: "include",
  });
  const body = await unwrap<{ docs: StrategyDocSummary[] }>(res);
  return body.docs;
}

export async function getStrategyDoc(name: string): Promise<StrategyDoc> {
  const res = await fetch(
    `/api/v1/strategy/docs/${encodeURIComponent(name)}`,
    { credentials: "include" }
  );
  return unwrap<StrategyDoc>(res);
}
