/**
 * The Delivery tab's verdict card in both modes (plan
 * `2026-10-23-console-presentation-spaces` Phase 5, D3.2 and D3.3).
 *
 * The lookup is a read, so it stays live in presentation mode. What changes is
 * what renders: a cited PR's repository — and its outbound link, whose URL
 * names it — and a deploy target show only when the tenant's presentation
 * scope clears them against their repository, and the raw JSON toggle is
 * `OperatorOnly`. The operator sees everything.
 *
 * The verdict is the page's own Spec CI stub with three cited PRs (one
 * first-party, one foreign, one with coord's bare repository name) and two
 * deploy targets (one first-party, one foreign) put in its place.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UIBridgeProvider } from "@qontinui/ui-bridge/react";
import type { PresentationScopeState } from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type { DeliveryVerdictResponse } from "../_lib/types";

const state = vi.hoisted(() => ({
  verdict: undefined as unknown,
}));

vi.mock("../_hooks/useDeliveryVerdict", () => ({
  useDeliveryVerdict: (slug: string) => ({
    data: slug.trim() ? state.verdict : undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    dataUpdatedAt: slug.trim() ? Date.parse("2026-10-23T12:00:00Z") : 0,
  }),
}));

import { DeliveryVerdictCard } from "./DeliveryVerdictCard";

const SPEC = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../specs/pages/digital-twin/state-machine.derived.json"
    ),
    "utf-8"
  )
) as { metadata: { routeStubs: { urlPattern: string; body: unknown }[] } };

const SLUG = "2026-06-15-twin-delivery-verdict-completion-view";

function verdict(): DeliveryVerdictResponse {
  const stub = SPEC.metadata.routeStubs.find(
    (s) => s.urlPattern === "**/api/v1/digital-twin/delivery/verdict**"
  );
  if (!stub) throw new Error("the spec stubs no delivery verdict");
  const body = structuredClone(stub.body) as DeliveryVerdictResponse;
  const components = body.verdict.components as Record<string, unknown>;
  components.prs = [
    { repo: "qontinui/qontinui-web", pr: 101, merged: true, branch: "a" },
    { repo: "acme-corp/portal", pr: 7, merged: true, branch: "b" },
    { repo: "qontinui-coord", pr: 655, merged: true, branch: "c" },
  ];
  components.deployed_envs = [
    {
      surface: "vercel",
      target: "web-production",
      repo: "qontinui/qontinui-web",
      in_sync: true,
      lag_seconds: 0,
      drift_class: "none",
      deployed_sha: "abc1234",
      observed_age_seconds: 30,
    },
    {
      surface: "ecs",
      target: "acme-portal-prod",
      repo: "acme-corp/portal",
      in_sync: false,
      lag_seconds: 60,
      drift_class: "lagging",
      deployed_sha: "def5678",
      observed_age_seconds: 30,
    },
  ];
  return body;
}

/** The tenant's scope: its own owner first-party, a client's name confidential. */
const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

function WithBridge({ children }: { children: ReactNode }) {
  return <UIBridgeProvider>{children}</UIBridgeProvider>;
}

async function lookUp() {
  const user = userEvent.setup();
  await user.type(
    screen.getByPlaceholderText(/approach-d-conductor-engine/),
    SLUG
  );
  await user.click(screen.getByRole("button", { name: /look up/i }));
  await screen.findByText("Cited PRs");
}

function envTargets(): string[] {
  return screen
    .getAllByTestId("delivery-env-target")
    .map((el) => el.textContent ?? "");
}

beforeEach(() => {
  state.verdict = verdict();
});

describe("DeliveryVerdictCard — operator mode", () => {
  it("shows every cited PR's repository and link, every deploy target, and the raw JSON", async () => {
    render(<DeliveryVerdictCard />, { wrapper: WithBridge });
    await lookUp();
    expect(screen.getByText("acme-corp/portal")).toBeInTheDocument();
    expect(
      document.querySelector(
        'a[href="https://github.com/acme-corp/portal/pull/7"]'
      )
    ).not.toBeNull();
    expect(envTargets()).toEqual([
      "vercel · web-production",
      "ecs · acme-portal-prod",
    ]);
    expect(
      screen.getByRole("button", { name: /show raw data/i })
    ).toBeInTheDocument();
  });
});

describe("DeliveryVerdictCard — presentation mode", () => {
  it("shows a first-party repository with its link, and withholds every other", async () => {
    const view = renderInPresentationMode(<DeliveryVerdictCard />, {
      scope: SCOPE,
    });
    await lookUp();

    expect(screen.getByText("qontinui/qontinui-web")).toBeInTheDocument();
    expect(
      document.querySelector(
        'a[href="https://github.com/qontinui/qontinui-web/pull/101"]'
      )
    ).not.toBeNull();

    // The foreign repository: no name, no link — only its PR number.
    expect(document.body.innerHTML).not.toMatch(/acme/i);
    expect(screen.getByText("#7")).toBeInTheDocument();
    // coord's bare name proves no owner: withheld, and not linked.
    expect(document.querySelector('a[href*="qontinui-coord"]')).toBeNull();
    expect(
      screen.getAllByText("Repository · area unknown · merged · age unknown")
    ).toHaveLength(2);

    expectPresentationSafe(view);
  });

  it("shows a first-party deploy target and withholds a client's", async () => {
    renderInPresentationMode(<DeliveryVerdictCard />, { scope: SCOPE });
    await lookUp();
    expect(envTargets()).toEqual([
      "vercel · web-production",
      "ecs · Deploy target · area unknown · not in sync · age unknown",
    ]);
  });

  it("withholds every repository and target while the scope is unknown", async () => {
    renderInPresentationMode(<DeliveryVerdictCard />);
    await lookUp();
    expect(screen.queryByText("qontinui/qontinui-web")).toBeNull();
    expect(document.querySelector('a[href*="github.com"]')).toBeNull();
    expect(envTargets()).toEqual([
      "vercel · Deploy target · area unknown · in sync · age unknown",
      "ecs · Deploy target · area unknown · not in sync · age unknown",
    ]);
  });

  it("holds back the raw JSON an agent receives", async () => {
    const view = renderInPresentationMode(<DeliveryVerdictCard />, {
      scope: SCOPE,
    });
    await lookUp();
    expect(screen.queryByRole("button", { name: /raw data/i })).toBeNull();
    expect(
      screen.queryByText(/The exact JSON an AI agent receives/)
    ).toBeNull();
    expectPresentationSafe(view);
  });
});
