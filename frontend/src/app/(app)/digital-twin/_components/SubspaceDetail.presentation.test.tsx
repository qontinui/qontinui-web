/**
 * The sub-space drawer in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3.3): what it says when the
 * row's live read fails. The Dialog is stubbed to render in place, as in
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

const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

/** `schema`, live-probed on a verdict door, so the drawer reads its raw verdict. */
function liveRow(): ResolvedSubspace {
  const entry = (manifest.subspaces as SubspaceManifestEntry[]).find(
    (r) => r.id === "schema"
  );
  if (!entry) throw new Error("no manifest row schema");
  return {
    ...entry,
    cellStatus: "implemented",
    liveProbed: true,
    doorShape: "verdict_wrapper",
  };
}

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
    render(<SubspaceDetail row={liveRow()} onOpenChange={() => {}} />);
    expect(
      screen.getByTestId("digital-twin-drawer-read-error")
    ).toHaveTextContent(HOST);
  });

  it("says only its HTTP status in presentation mode", () => {
    const view = renderInPresentationMode(
      <SubspaceDetail row={liveRow()} onOpenChange={() => {}} />,
      {
        scope: SCOPE,
        uiBridge: {
          unobservable:
            "this file mocks @qontinui/ui-bridge/react; the page proof reads the real registry",
        },
      }
    );
    expect(
      screen.getByTestId("digital-twin-drawer-read-error")
    ).toHaveTextContent(/^Could not read the live verdict \(HTTP 502\)\.$/);
    expectPresentationSafe(view, { forbidden: [HOST, "acme"] });
  });
});
