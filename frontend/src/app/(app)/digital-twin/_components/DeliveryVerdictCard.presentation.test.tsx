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
 *
 * In both modes the card's sentences hold after the read they describe: a
 * staleness is the verdict's when read, the data's own source is not labelled
 * like the chip's reader, and a verdict kept after a failed read is the last
 * one read.
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
  /** When set, a lookup fails with this error instead of answering. */
  error: null as unknown,
  /**
   * With `error` set: react-query still holds the verdict an earlier read
   * returned, as it does when a refetch fails.
   */
  retained: false,
}));

vi.mock("../_hooks/useDeliveryVerdict", () => ({
  useDeliveryVerdict: (slug: string) => {
    const asked = slug.trim() !== "";
    const failed = asked && state.error !== null;
    const held = asked && (!failed || state.retained);
    return {
      data: held ? state.verdict : undefined,
      isLoading: false,
      isError: failed,
      error: failed ? state.error : null,
      isFetching: false,
      dataUpdatedAt: held ? Date.parse("2026-10-23T12:00:00Z") : 0,
    };
  },
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

async function ask() {
  const user = userEvent.setup();
  await user.type(
    screen.getByPlaceholderText(/approach-d-conductor-engine/),
    SLUG
  );
  await user.click(screen.getByRole("button", { name: /look up/i }));
}

async function lookUp() {
  await ask();
  await screen.findByText("Cited PRs");
}

function envTargets(): string[] {
  return screen
    .getAllByTestId("delivery-env-target")
    .map((el) => el.textContent ?? "");
}

beforeEach(() => {
  state.verdict = verdict();
  state.error = null;
  state.retained = false;
});

/** A host and a client named only in the upstream error body. */
const HOST = "coord.internal.acme-corp.example";
const LEAKY = new Error(
  `GET /api/v1/digital-twin/delivery/verdict?work_unit_slug=${SLUG} failed: 502 - upstream https://${HOST}:8443 refused the connection for Acme Corp`
);

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

describe("DeliveryVerdictCard — a failed lookup", () => {
  it("gives the operator the failing read's own message", async () => {
    state.error = LEAKY;
    render(<DeliveryVerdictCard />, { wrapper: WithBridge });
    await ask();
    expect(
      await screen.findByTestId("delivery-verdict-error")
    ).toHaveTextContent(HOST);
  });

  it("says only its HTTP status in presentation mode", async () => {
    state.error = LEAKY;
    const view = renderInPresentationMode(<DeliveryVerdictCard />, {
      scope: SCOPE,
    });
    await ask();
    expect(
      await screen.findByTestId("delivery-verdict-error")
    ).toHaveTextContent(/^Could not read the delivery verdict \(HTTP 502\)\.$/);
    expectPresentationSafe(view, { forbidden: [HOST, "acme"] });
  });
});

describe("DeliveryVerdictCard — coord's unit status and internal id", () => {
  /** A status a tenant wrote, naming a client. */
  const OPAQUE = "waiting-on-acme-corp-legal";
  const PLAN_ID = "0b9d6a54-1c2e-4f3a-8b7d-5e6f7a8b9c0d";

  function components(): Record<string, unknown> {
    return (state.verdict as DeliveryVerdictResponse).verdict
      .components as Record<string, unknown>;
  }

  it("shows the operator coord's own status and, with no slug, its internal id", async () => {
    components().status = OPAQUE;
    components().slug = null;
    components().plan_id = PLAN_ID;
    render(<DeliveryVerdictCard />, { wrapper: WithBridge });
    await lookUp();
    expect(screen.getAllByText(new RegExp(OPAQUE)).length).toBe(2);
    expect(screen.getByText(PLAN_ID)).toBeInTheDocument();
  });

  it("says an unrecognised status in the console's fixed words, in the fact and the sentence", async () => {
    components().status = OPAQUE;
    const view = renderInPresentationMode(<DeliveryVerdictCard />, {
      scope: SCOPE,
    });
    await lookUp();
    const fact = screen.getByText("Plan status").closest("div")!;
    expect(fact).toHaveTextContent(/^Plan status\s*Status unknown$/);
    expect(
      screen.getByText(
        /Plan status “Status unknown”; 3 cited PRs, all merged\./
      )
    ).toBeInTheDocument();
    expectPresentationSafe(view, { forbidden: [OPAQUE, "acme"] });
  });

  it("keeps a recognised status's own word", async () => {
    // The stub's own status, `shipped`.
    const view = renderInPresentationMode(<DeliveryVerdictCard />, {
      scope: SCOPE,
    });
    await lookUp();
    const fact = screen.getByText("Plan status").closest("div")!;
    expect(fact).toHaveTextContent(/^Plan status\s*Shipped$/);
    expectPresentationSafe(view);
  });

  it("shows a dash, not coord's internal id, when the verdict names no slug", async () => {
    components().slug = null;
    components().plan_id = PLAN_ID;
    const view = renderInPresentationMode(<DeliveryVerdictCard />, {
      scope: SCOPE,
    });
    await lookUp();
    const fact = screen.getByText("Plan").closest("div")!;
    expect(fact).toHaveTextContent(/^Plan\s*—$/);
    expectPresentationSafe(view, { forbidden: [PLAN_ID] });
  });
});

describe("DeliveryVerdictCard — what it says of a read, after that read", () => {
  /** Each mode's render of the card, with a verdict looked up. */
  const MODES = [
    [
      "operator",
      () => {
        render(<DeliveryVerdictCard />, { wrapper: WithBridge });
        return null;
      },
    ],
    [
      "presenting",
      () => renderInPresentationMode(<DeliveryVerdictCard />, { scope: SCOPE }),
    ],
  ] as const;

  /** The value of the fact labelled exactly `label`, or `null` without one. */
  function fact(label: string): string | null {
    const dt = [...document.querySelectorAll("dt")].find(
      (el) => el.textContent === label
    );
    return dt?.nextElementSibling?.textContent ?? null;
  }

  for (const [mode, renderCard] of MODES) {
    it(`words each staleness as of its read, never as an age now · ${mode}`, async () => {
      (state.verdict as DeliveryVerdictResponse).verdict.staleness_seconds = 45;
      const view = renderCard();
      await lookUp();
      const envelope = screen.getByTestId("delivery-verdict-envelope");
      expect(envelope).toHaveTextContent("45s stale when read");
      expect(document.body).toHaveTextContent(
        "its data was 45s stale when read, from coord_delivery_join_live."
      );
      expect(fact("Freshness when read")).toBe("45s stale");
      expect(fact("Freshness")).toBeNull();
      // Each deploy observation's age, as of the same read.
      for (const row of screen.getAllByTestId("delivery-env-target")) {
        expect(row.closest("li")).toHaveTextContent("30s stale when read");
      }
      expect(document.body.textContent).not.toMatch(/data is \d|data is live/);
      if (view) expectPresentationSafe(view);
    });

    it(`says a verdict computed live was live when read · ${mode}`, async () => {
      // coord omits a DriftVerdict's staleness on an answer it computed live.
      delete (state.verdict as DeliveryVerdictResponse).verdict
        .staleness_seconds;
      const view = renderCard();
      await lookUp();
      expect(screen.getByTestId("delivery-verdict-envelope")).toHaveTextContent(
        "live when read"
      );
      expect(fact("Freshness when read")).toBe("live");
      if (view) expectPresentationSafe(view);
    });

    it(`labels the data's own source apart from the chip that names its reader · ${mode}`, async () => {
      const view = renderCard();
      await lookUp();
      expect(fact("Data source")).toBe("coord_delivery_join_live");
      expect(fact("Source")).toBeNull();
      if (view) expectPresentationSafe(view);
    });

    it(`introduces a verdict kept after a failed read as the last one read, the failure first · ${mode}`, async () => {
      state.error = LEAKY;
      state.retained = true;
      const view = renderCard();
      await lookUp();
      const failure = screen.getByTestId("delivery-verdict-error");
      const lead = screen.getByTestId("delivery-verdict-retained");
      const envelope = screen.getByTestId("delivery-verdict-envelope");
      expect(lead).toHaveTextContent(/^As last read, before that failure:$/);
      // The failure leads, then the lead, then the verdict it introduces.
      expect(
        failure.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        lead.compareDocumentPosition(envelope) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      if (view) expectPresentationSafe(view, { forbidden: [HOST, "acme"] });
    });
  }

  it("has no lead line over a verdict the latest read returned", async () => {
    render(<DeliveryVerdictCard />, { wrapper: WithBridge });
    await lookUp();
    expect(screen.queryByTestId("delivery-verdict-retained")).toBeNull();
  });
});
