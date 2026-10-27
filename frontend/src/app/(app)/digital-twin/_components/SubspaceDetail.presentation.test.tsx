/**
 * The sub-space drawer in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3): what it says when the row's
 * live read fails, and the plan building a row, which is plain text while
 * its work-unit page cannot be presented. The Dialog is stubbed to render in
 * place, as in
 * `SubspaceDetail.navigation.test.tsx`, so the drawer is inside the view the
 * page check reads; the page proof (`page.presentation-proof.test.tsx`)
 * drives the real one.
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationScopeState } from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type { ProbeAttempt } from "../_lib/probe-read";
import manifest from "../_lib/subspaces.manifest.json";
import type { ResolvedSubspace, SubspaceManifestEntry } from "../_lib/types";

const state = vi.hoisted(() => ({
  raw: {} as Record<string, unknown>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  // The drawer's own props pass through, its navigation-only mark included.
  DialogClose: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("../_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: () => state.raw,
}));

import { SubspaceDetail } from "./SubspaceDetail";

/** A host and a client named only in the upstream error body. */
const HOST = "coord.internal.acme-corp.example";
const LEAKY = new Error(
  `GET /api/v1/digital-twin/subspace/schema/raw failed: 502 - upstream https://${HOST}:8443 refused the connection for Acme Corp`
);

/** The probe the rows answer from: current, nothing failed. */
const PROBE: ProbeAttempt = {
  failed: false,
  refreshFailed: false,
  error: null,
  degraded: null,
  unanswered: null,
  asOf: Date.parse("2026-10-23T12:00:00Z"),
  failedAt: null,
};

const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

function manifestRow(id: string): SubspaceManifestEntry {
  const entry = (manifest.subspaces as SubspaceManifestEntry[]).find(
    (r) => r.id === id
  );
  if (!entry) throw new Error(`no manifest row ${id}`);
  return entry;
}

/** `schema`, live-probed on a verdict door, so the drawer reads its raw verdict. */
function liveRow(): ResolvedSubspace {
  return {
    ...manifestRow("schema"),
    cellStatus: "implemented",
    liveProbed: true,
    doorShape: "verdict_wrapper",
  };
}

const UNOBSERVED = {
  unobservable:
    "this file mocks @qontinui/ui-bridge/react; the page proof reads the real registry",
} as const;

beforeEach(() => {
  state.raw = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: LEAKY,
  };
});

describe("SubspaceDetail — a failed live read", () => {
  it("gives the operator the failing read's own message", () => {
    render(
      <SubspaceDetail row={liveRow()} probe={PROBE} onOpenChange={() => {}} />
    );
    expect(
      screen.getByTestId("digital-twin-drawer-read-error")
    ).toHaveTextContent(HOST);
  });

  it("says only its HTTP status in presentation mode", () => {
    const view = renderInPresentationMode(
      <SubspaceDetail row={liveRow()} probe={PROBE} onOpenChange={() => {}} />,
      { scope: SCOPE, uiBridge: UNOBSERVED }
    );
    expect(
      screen.getByTestId("digital-twin-drawer-read-error")
    ).toHaveTextContent(/^Could not read the live verdict \(HTTP 502\)\.$/);
    expectPresentationSafe(view, { forbidden: [HOST, "acme"] });
  });
});

describe("SubspaceDetail — Planned in, while presenting", () => {
  it("names the plan building a row as plain text: its work-unit page cannot be presented", () => {
    // `flow` is built by an explicit manifest plan slug — the product's own
    // name for it, not a tenant's, so it shows.
    const flow: ResolvedSubspace = {
      ...manifestRow("flow"),
      cellStatus: "planned",
      liveProbed: false,
    };
    expect(flow.plan).toBeTruthy();
    const view = renderInPresentationMode(
      <SubspaceDetail row={flow} probe={PROBE} onOpenChange={() => {}} />,
      { scope: SCOPE, uiBridge: UNOBSERVED }
    );
    const planned = screen.getByTestId("digital-twin-drawer-plan-link");
    expect(planned).toHaveTextContent(flow.plan!);
    expect(planned).toHaveAttribute("data-lens-link", "unlinked");
    expect(planned.closest("a")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expectPresentationSafe(view);
  });
});
