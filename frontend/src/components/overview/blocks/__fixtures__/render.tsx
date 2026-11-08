/**
 * How the block tests render markdown: through the two surfaces that host it
 * — `PageBody` (documents and wiki pages) and `IntentSection` (the Summary) —
 * never through `LiveBlock` directly (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview`
 * Phase 2, Arming).
 *
 * A test file mocks `@/components/overview/editing/api` (the overview's
 * reads) with {@link apiMocks}' functions and serves reports with
 * {@link serveReports}; the in-app report source then reads them exactly as a
 * document page would.
 */

import { screen } from "@testing-library/react";
import { vi } from "vitest";
import { IntentSection } from "@/app/(app)/overview/_components/IntentSection";
import { PageBody } from "@/app/(app)/overview/_components/PageBody";
import {
  toIntentEntry,
  type IntentDocument,
} from "@/app/(app)/overview/_lib/intent";
import type { PageRecord } from "@/app/(app)/overview/_lib/pages";
import type { ReportView } from "./reportView";

/** A document whose text is `body`. */
export function pageWith(body: string): PageRecord {
  return {
    id: "doc-1",
    kind: "document",
    slug: "progress-notes",
    title: "Progress notes",
    body_md: body,
    excerpt: "",
    doc_number: null,
    doc_status: null,
    owner: null,
    related: [],
    version: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    created_by: null,
    updated_by: null,
    source_repo: null,
    source_path: null,
    source_sha: null,
  };
}

/** `body` as a document page shows it, to a reader who may not edit. */
export function InPageBody({ body }: { body: string }) {
  return (
    <PageBody
      page={pageWith(body)}
      canEdit={false}
      projectId="p1"
      viewerId="u1"
      wikiLinks={{ exists: () => true, canCreate: false }}
      save={async () => ({ ok: false, error: "read only" })}
      onReplaced={() => {}}
      emptyText="Nothing written yet."
      uiBridgeId="overview.documents.page"
    />
  );
}

/** Wait for the page's own reads (its backlinks) to settle, so a test that
 *  asserts at once does not end while the page is still updating. */
export async function pageSettled(): Promise<void> {
  await screen.findByText("No other page links here yet.");
}

/** `body` as the Summary shows a written part of the description. */
export function InIntentSection({ body }: { body: string }) {
  const doc: IntentDocument = {
    id: "product_intent:about",
    kind: "product_intent",
    name: "about",
    description: null,
    body: `# About this project\n\n${body}`,
    frontmatter: null,
    overview_order: null,
    state: "authored",
    error: null,
    status: null,
    withdrawn: false,
    version: 1,
    updated_at: null,
    updated_by: null,
  };
  return (
    <IntentSection
      kind="product_intent"
      entries={[toIntentEntry(doc)]}
      actions={{
        canEdit: false,
        projectId: "p1",
        viewerId: "u1",
        saveBody: vi.fn(),
        move: vi.fn(),
        createDocument: vi.fn(),
      }}
    />
  );
}

/** A fenced block, as a writer types it. */
export function fence(language: string, ...lines: string[]): string {
  return ["```" + language, ...lines, "```"].join("\n");
}

/**
 * The overview reads the tests stub. Each test file builds them in
 * `vi.hoisted` and spreads them over the real `editing/api` module:
 *
 *     const api = vi.hoisted(() => ({
 *       listResource: vi.fn(),
 *       fetchReportView: vi.fn(),
 *       fetchPageBacklinks: vi.fn(async () => []),
 *     }));
 *     vi.mock("@/components/overview/editing/api", async (original) => ({
 *       ...(await original<object>()),
 *       ...api,
 *     }));
 */
export interface ApiMocks {
  listResource: ReturnType<typeof vi.fn>;
  fetchReportView: ReturnType<typeof vi.fn>;
}

/** Serve `views` as the project's reports: the slug-filtered list, then each
 *  view by id. Every other list is empty. */
export function serveReports(api: ApiMocks, views: ReportView[]): void {
  api.listResource.mockImplementation(
    async (path: string, params?: Record<string, string>) => {
      const items =
        path === "reports"
          ? views
              .map((v) => v.report)
              .filter((r) => !params?.slug || r.slug === params.slug)
          : [];
      return { items, total: items.length, can_edit: false, degraded: null };
    }
  );
  api.fetchReportView.mockImplementation(async (id: string) => {
    const view = views.find((v) => v.report.id === id);
    if (!view)
      throw new Error(`GET /reports/${id}/view failed: 404 - no such report`);
    return view;
  });
}

/** Put the page at a document's address, with `search` as its query. */
export function atAddress(search = ""): void {
  window.history.replaceState({}, "", `/overview/documents/doc-1${search}`);
}
