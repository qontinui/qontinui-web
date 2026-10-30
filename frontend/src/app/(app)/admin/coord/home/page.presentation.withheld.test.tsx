/**
 * /admin/coord/home in presentation mode: the arms a fixture's ordinary rows do
 * not reach (plan `2026-10-23-console-presentation-spaces` Phase 2). Each is a
 * value that would read as an identifier if the lens let it through: a subject
 * with no name but an id, a unit whose slug names a client under a clean title,
 * a first-party repository whose name carries a confidential term, and a plane
 * the page's table does not name. `page.presentation.test.tsx` holds the page's
 * full proof.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import {
  WITHHELD,
  FixedPresentationMode,
  sessionMachineAliases,
} from "@/components/presentation";
import { FAILURE_SENTENCE_WITHHELD } from "@/components/operations/presentedFailure";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import {
  CLIENT_PLANE,
  FIRST_PARTY_REPO,
  MUST_NOT_APPEAR,
  NAMELESS_SUBJECT_ID,
  OFF_TABLE_WATCHER,
  SCOPE,
  UNNAMED_PLANE,
  fullBody,
  namelessSubjectBody,
  offTablePlanesBody,
  oneGroupBody,
} from "./__fixtures__/presentationFixture";
import {
  checkBehindEveryDisclosure,
  expandRow,
} from "./__fixtures__/homePageDriver";

const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

vi.mock("@/contexts/tenant-context", async () => {
  const f = await import("./__fixtures__/presentationFixture");
  return {
    useTenant: () => ({
      tenants: [{ id: f.TENANT_ID, name: f.TENANT_NAME }],
      activeTenantId: f.TENANT_ID,
      loading: false,
      error: null,
    }),
  };
});

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/coord/home",
}));

import CoordHomePage from "./page";

function answerWith(body: unknown) {
  httpFetch.mockImplementation(async () => new Response(JSON.stringify(body)));
}

async function landed() {
  await waitFor(() => expect(httpFetch).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
}

async function renderPresenting(body: unknown) {
  answerWith(body);
  const view = renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
  await landed();
  return view;
}

async function renderOperator(body: unknown) {
  answerWith(body);
  render(
    <FixedPresentationMode presenting={false}>
      <CoordHomePage />
    </FixedPresentationMode>
  );
  await landed();
}

function html(): string {
  return document.body.innerHTML.toLowerCase();
}

beforeEach(() => {
  httpFetch.mockReset();
  sessionMachineAliases.reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("a degradation's subject with an id and no name", () => {
  it("reads as unnamed while presenting: its id never reaches the DOM", async () => {
    const view = await renderPresenting(namelessSubjectBody());
    const row = screen.getByTestId("coord-home.degrading.degrading");
    expect(within(row).getByTestId("row-reason")).toHaveTextContent(
      /^unnamed subject$/
    );
    checkBehindEveryDisclosure(() => {
      expectPresentationSafe(view, { forbidden: [NAMELESS_SUBJECT_ID] });
      expect(html()).not.toContain(NAMELESS_SUBJECT_ID);
    });
  });

  it("(control) the operator reads the same words, its id one disclosure down", async () => {
    await renderOperator(namelessSubjectBody());
    const row = screen.getByTestId("coord-home.degrading.degrading");
    expect(within(row).getByTestId("row-reason")).toHaveTextContent(
      /^unnamed subject$/
    );
    expect(
      within(expandRow(row, "unnamed subject")).getByTestId(
        "coord-home.degrading.raw"
      )
    ).toHaveTextContent(`subject ${NAMELESS_SUBJECT_ID}`);
  });
});

describe("a work unit's link, whose URL carries its slug", () => {
  /** The first-party repository's row opened, and its one unit's name. */
  function unitName() {
    const own = expandRow(
      screen.getByTestId("coord-home.on-track"),
      FIRST_PARTY_REPO
    );
    const name = own.querySelector(
      '[data-testid^="coord-home.on-track.named."] [data-redacted]'
    );
    if (!name) throw new Error("no unit named");
    return name;
  }

  it("is not linked when its title names a client, whatever its slug", async () => {
    const view = await renderPresenting(
      oneGroupBody(FIRST_PARTY_REPO, [
        { slug: "2026-10-01-rollout", title: "Acme Corp rollout" },
      ])
    );
    const name = unitName();
    expect(name).toHaveAttribute("data-redacted", "true");
    expect(name.closest("[data-lens-link]")).toBeNull();
    expect(html()).not.toContain("2026-10-01-rollout");
    expectPresentationSafe(view, { forbidden: ["acme"] });
  });

  it("is not linked when its slug names a client, though its title shows", async () => {
    const view = await renderPresenting(
      oneGroupBody(FIRST_PARTY_REPO, [
        { slug: "2026-10-01-acme-rollout", title: "Overview copy pass" },
      ])
    );
    const name = unitName();
    expect(name).toHaveAttribute("data-redacted", "false");
    expect(name).toHaveTextContent("Overview copy pass");
    expect(name.closest("[data-lens-link]")).toBeNull();
    expect(html()).not.toContain("acme-rollout");
    expectPresentationSafe(view, { forbidden: ["acme"] });
  });

  it("is handed to the lens's link when the scope clears both", async () => {
    await renderPresenting(
      oneGroupBody(FIRST_PARTY_REPO, [
        { slug: "2026-10-01-rollout", title: "Overview copy pass" },
      ])
    );
    expect(unitName().closest("[data-lens-link]")).not.toBeNull();
  });

  it("names an untitled unit by its slug when the scope clears it", async () => {
    await renderPresenting(
      oneGroupBody(FIRST_PARTY_REPO, [
        { slug: "2026-10-01-rollout", title: null },
      ])
    );
    const name = unitName();
    expect(name).toHaveAttribute("data-redacted", "false");
    expect(name).toHaveTextContent("2026-10-01-rollout");
    expect(name.closest("[data-lens-link]")).not.toBeNull();
  });

  it("withholds an untitled unit whose slug names a client, and does not link it", async () => {
    const view = await renderPresenting(
      oneGroupBody(FIRST_PARTY_REPO, [
        { slug: "2026-10-01-acme-rollout", title: null },
      ])
    );
    const name = unitName();
    expect(name).toHaveAttribute("data-redacted", "true");
    expect(name.closest("[data-lens-link]")).toBeNull();
    expectPresentationSafe(view, { forbidden: ["acme"] });
  });

  it("(control) the operator's link names and opens every one of them", async () => {
    await renderOperator(
      oneGroupBody(FIRST_PARTY_REPO, [
        { slug: "2026-10-01-acme-rollout", title: null },
      ])
    );
    const own = expandRow(
      screen.getByTestId("coord-home.on-track"),
      FIRST_PARTY_REPO
    );
    expect(
      within(own).getByRole("link", { name: "2026-10-01-acme-rollout" })
    ).toHaveAttribute(
      "href",
      "/admin/coord/work-units/2026-10-01-acme-rollout"
    );
  });
});

describe("a first-party repository whose name carries a confidential term", () => {
  const REPO = "qontinui/acme-portal";

  it("is a descriptor on its row and 'this repository' in its detail", async () => {
    const view = await renderPresenting(
      oneGroupBody(REPO, [{ slug: "2026-10-01-rollout", title: "A pass" }])
    );
    const region = screen.getByTestId("coord-home.on-track");
    const row = expandRow(region, /^Repository/);
    expect(row).toHaveTextContent("Work units that name this repository.");
    checkBehindEveryDisclosure(() => {
      expectPresentationSafe(view, { forbidden: [REPO, "acme"] });
      expect(html()).not.toContain("acme");
    });
  });
});

describe("a watcher source's error, while presenting", () => {
  it("is worded from coord's token rather than withheld: the token quotes nothing", async () => {
    await renderPresenting(fullBody());
    const row = expandRow(
      screen.getByTestId("coord-home.does-not-know"),
      "Watcher feeding runner"
    );
    expect(row).toHaveTextContent(/No successful/i);
    expect(row).not.toHaveTextContent(FAILURE_SENTENCE_WITHHELD);
  });
});

describe("a plane the page's table does not name", () => {
  it("reads as withheld everywhere while presenting, and only the table's words show", async () => {
    const view = await renderPresenting(offTablePlanesBody());
    const region = screen.getByTestId("coord-home.degrading");
    const rows = within(region).getAllByTestId(
      "coord-home.degrading.degrading"
    );
    expect(rows).toHaveLength(3);
    const [client, unnamed, known] = rows;

    // The row identity, its headline's descriptor and its subject's descriptor.
    for (const row of [client!, unnamed!]) {
      expect(row.querySelector("[data-console-row] > span")).toHaveTextContent(
        new RegExp(`^${WITHHELD}$`)
      );
      expect(row).toHaveTextContent(/Degradation · area withheld · degrading/);
      expect(within(row).getByTestId("row-reason")).toHaveTextContent(
        /^Service · area withheld · degrading · /
      );
    }
    expect(known!.querySelector("[data-console-row] > span")).toHaveTextContent(
      /^runner$/
    );
    expect(known).toHaveTextContent(/Degradation · runner · degrading/);

    // The gap sentence, for a plane with a watcher and for one without.
    expect(
      screen.getByTestId("coord-home.degrading.incomplete")
    ).toHaveTextContent(
      /^Incomplete view — not every watcher is fresh \(withheld\); the withheld reading could not be taken\. /
    );

    // The watcher lines, whose element carries no key either.
    const lines = [
      ...screen
        .getByTestId("coord-home.degrading.planes")
        .querySelectorAll("li"),
    ];
    expect(lines.map((l) => l.textContent)).toEqual([
      "withheld: no watcher; its reading could not be taken",
      expect.stringMatching(/^withheld: 1 of 1 watcher not fresh/),
      "runner: read directly, no watcher",
    ]);
    expect(lines.map((l) => l.getAttribute("data-plane"))).toEqual([
      null,
      null,
      "runner",
    ]);

    // A watcher source's label.
    expect(screen.getByTestId("coord-home.does-not-know")).toHaveTextContent(
      "Watcher feeding withheld"
    );

    const needles = [
      CLIENT_PLANE,
      UNNAMED_PLANE,
      UNNAMED_PLANE.replace(/_/g, " "),
      OFF_TABLE_WATCHER,
      "acme",
    ];
    checkBehindEveryDisclosure(() => {
      expectPresentationSafe(view, {
        forbidden: [...needles, ...MUST_NOT_APPEAR],
      });
      for (const needle of needles) expect(html()).not.toContain(needle);
    });
  });

  it("(control) the operator keeps coord's key, spaced, as it always has", async () => {
    await renderOperator(offTablePlanesBody());
    const region = screen.getByTestId("coord-home.degrading");
    const [client, unnamed] = within(region).getAllByTestId(
      "coord-home.degrading.degrading"
    );
    expect(
      client!.querySelector("[data-console-row] > span")
    ).toHaveTextContent(/^acme corp vpn$/);
    expect(
      unnamed!.querySelector("[data-console-row] > span")
    ).toHaveTextContent(/^partner a tunnel$/);
    expect(
      screen.getByTestId("coord-home.degrading.incomplete")
    ).toHaveTextContent(
      /not every watcher is fresh \(partner a tunnel\); the acme corp vpn reading could not be taken/
    );
    const lines = [
      ...screen
        .getByTestId("coord-home.degrading.planes")
        .querySelectorAll("li"),
    ];
    expect(lines.map((l) => l.getAttribute("data-plane"))).toEqual([
      CLIENT_PLANE,
      UNNAMED_PLANE,
      "runner",
    ]);
    expect(screen.getByTestId("coord-home.does-not-know")).toHaveTextContent(
      "Watcher feeding partner a tunnel"
    );
  });
});
