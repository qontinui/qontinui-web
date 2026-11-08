/**
 * SavedSessionListsPanel — "Saved tab lists" on `/sessions`.
 *
 * Plan `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3, step 3: the panel's list / empty / unknown / stale states, the save
 * flow and every typed refusal, the detail's grouping by tab (D2) and its
 * finished badges (D3), the 14-day countdown, delete, Copy as Markdown and the
 * runner filter.
 *
 * Only the network is faked: `httpClient.fetch` answers from
 * `src/test/savedSessionListsFixture.ts`, so every request runs through the
 * real typed clients. `DestructiveButton` is replaced by a plain button
 * because jsdom cannot produce the trusted click it requires (its own test
 * covers that gate).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CAPTURE_REFUSALS,
  DAY_MS,
  DEVICE_A,
  DEVICE_B,
  DEVICE_C,
  NOW,
  createFakeNetwork,
  detail,
  iso,
  layoutPages,
  runner,
  seedList,
  type FakeNetwork,
} from "@/test/savedSessionListsFixture";

const holder = vi.hoisted(() => ({
  fetch: null as
    | null
    | ((url: string, init?: RequestInit) => Promise<Response>),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (url: string, init?: RequestInit) => {
      if (holder.fetch === null) throw new Error("no fake network installed");
      return holder.fetch(url, init);
    },
  },
}));

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import { SavedSessionListsPanel } from "./SavedSessionListsPanel";

let net: FakeNetwork;

beforeEach(() => {
  net = createFakeNetwork();
  holder.fetch = net.fetch;
  window.localStorage.clear();
});

const HOSTS: Record<string, string> = {
  [DEVICE_A]: "merytshost",
  [DEVICE_C]: "laptop",
};

function mount() {
  return render(
    <SavedSessionListsPanel now={NOW} hostnameFor={(id) => HOSTS[id]} />
  );
}

const count = () => screen.getByTestId("saved-tab-lists-count");
const listReads = () =>
  net.calls.filter(
    (c) => c.method === "GET" && c.path === "/api/v1/saved-session-lists"
  ).length;

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^saved tab lists/i }));
}

async function rows() {
  return screen.findAllByTestId("saved-tab-lists-row");
}

/** The row's own button — the line, not anything inside its detail. */
function rowLine(row: HTMLElement): HTMLElement {
  const line = row.querySelector<HTMLElement>("button[data-console-row]");
  if (line === null) throw new Error("row has no line button");
  return line;
}

describe("the collapsed panel", () => {
  it("is closed by default and reads only the list its header counts", async () => {
    seedList(net, detail({ id: "l1" }));
    seedList(net, detail({ id: "l2" }));
    mount();
    // Not read yet: a dash, never a zero.
    expect(count()).toHaveTextContent("–");
    await waitFor(() => expect(count()).toHaveTextContent("2"));
    expect(screen.queryByTestId("saved-tab-lists-save-form")).toBeNull();
    // The runners, layouts and everything else wait for the panel to open.
    expect(net.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/v1/saved-session-lists",
    ]);
  });
});

describe("the list", () => {
  it("shows one row per list: runner, title, countdown, counts, saver, time", async () => {
    const user = userEvent.setup();
    seedList(
      net,
      detail({ id: "l1", title: "Before rebuild", captured_at: iso(NOW) })
    );
    mount();
    await open(user);
    const [row] = await rows();
    if (!row) throw new Error("no row");
    expect(row).toHaveAttribute("data-row-key", "l1");
    expect(row.parentElement).toHaveAttribute(
      "data-ui-bridge-id",
      "sessions.saved-tab-lists.row.l1"
    );
    const line = rowLine(row);
    expect(line).toHaveTextContent("merytshost");
    expect(line).toHaveTextContent("Before rebuild");
    expect(
      within(line).getByTestId("saved-tab-lists-countdown")
    ).toHaveTextContent("deletes in 14 days");
    expect(within(line).getByTestId("row-reason")).toHaveTextContent(
      "4 tabs · 6 sessions · saved by Josh"
    );
    expect(within(line).getByTestId("row-time")).toHaveAttribute(
      "title",
      expect.stringMatching(/^Saved /)
    );
  });

  it("counts down to each list's deletion", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "fresh", captured_at: iso(NOW - 3 * DAY_MS) }));
    seedList(net, detail({ id: "old", captured_at: iso(NOW - 12.5 * DAY_MS) }));
    mount();
    await open(user);
    const [fresh, old] = await rows();
    if (!fresh || !old) throw new Error("rows missing");
    expect(
      within(fresh).getByTestId("saved-tab-lists-countdown")
    ).toHaveTextContent("deletes in 11 days");
    const oldCountdown = within(old).getByTestId("saved-tab-lists-countdown");
    expect(oldCountdown).toHaveTextContent("deletes in 36 hours");
    expect(oldCountdown).toHaveAttribute(
      "title",
      expect.stringMatching(/^Deleted automatically /)
    );
  });

  it("says so when there are no saved lists", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(count()).toHaveTextContent("0"));
    await open(user);
    expect(
      await screen.findByTestId("saved-tab-lists-empty")
    ).toHaveTextContent(/No saved tab lists yet/);
  });

  it("reports a failed first read as unknown — never as none", async () => {
    const user = userEvent.setup();
    net.listAnswer = {
      status: 502,
      body: { error: "BAD_GATEWAY", message: "coord is not reachable" },
    };
    mount();
    await waitFor(() =>
      expect(count()).toHaveAttribute("title", expect.stringMatching(/unknown/))
    );
    expect(count()).toHaveTextContent("–");
    await open(user);
    const unknown = await screen.findByTestId("saved-tab-lists-unknown");
    expect(unknown).toHaveTextContent(/unknown — not none/);
    expect(unknown).toHaveTextContent(/coord is not reachable/);
    expect(screen.queryByTestId("saved-tab-lists-empty")).toBeNull();
    expect(screen.queryByText(/No saved tab lists/)).toBeNull();
  });

  it("keeps the rows of the last good read, marked stale, when a refresh fails", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    seedList(net, detail({ id: "l2" }));
    mount();
    await open(user);
    expect(await rows()).toHaveLength(2);
    net.listAnswer = { status: 500, body: { message: "boom" } };
    await user.click(
      screen.getByRole("button", { name: "Refresh saved tab lists" })
    );
    expect(
      await screen.findByTestId("saved-tab-lists-stale")
    ).toHaveTextContent(/latest refresh failed/);
    expect(await rows()).toHaveLength(2);
    expect(count()).toHaveTextContent("2*");
    expect(count()).toHaveTextContent(/stale/);
  });

  it("filters by runner, with a count per runner", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "a1", device_id: DEVICE_A }));
    seedList(net, detail({ id: "c1", device_id: DEVICE_C }));
    seedList(net, detail({ id: "a2", device_id: DEVICE_A }));
    mount();
    await open(user);
    expect(await rows()).toHaveLength(3);
    expect(screen.getByTestId("saved-tab-lists-filter-all")).toHaveTextContent(
      "All runners3"
    );
    const laptop = screen.getByTestId(`saved-tab-lists-filter-${DEVICE_C}`);
    expect(laptop).toHaveTextContent("laptop1");
    await user.click(laptop);
    const shown = await rows();
    expect(shown.map((r) => r.getAttribute("data-row-key"))).toEqual(["c1"]);
  });
});

describe("saving", () => {
  it("saves the connected runner's tabs and opens the new list", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(count()).toHaveTextContent("0"));
    await open(user);
    // The only relay-connected runner is the choice.
    const picker = await screen.findByTestId("saved-tab-lists-runner-picker");
    const radioA = await within(picker).findByRole("radio", {
      name: /merytshost/,
    });
    expect(radioA).toBeChecked();
    await user.type(
      screen.getByTestId("saved-tab-lists-title"),
      "  Before rebuild "
    );
    await user.click(screen.getByTestId("saved-tab-lists-save"));

    expect(
      await screen.findByTestId("saved-tab-lists-saved")
    ).toHaveTextContent(
      'Saved "Before rebuild" from merytshost: 4 tabs, 6 sessions'
    );
    const post = net.calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({
      device_id: DEVICE_A,
      title: "Before rebuild",
    });

    // Opened at once, from the capture's own answer — no second read.
    const detailEl = await screen.findByTestId("saved-tab-list-detail");
    expect(detailEl).toHaveAttribute(
      "data-ui-bridge-id",
      "sessions.saved-tab-lists.detail"
    );
    expect(
      within(detailEl)
        .getAllByTestId("saved-tab-list-tab-heading")
        .map((h) => h.firstChild?.textContent)
    ).toEqual([
      "Build",
      "Review (1b1b1b1b)",
      "Review (2c2c2c2c)",
      "Tab 3d3d3d3d (name not reported)",
    ]);
    expect(
      net.calls.some(
        (c) => c.method === "GET" && /saved-session-lists\/./.test(c.path)
      )
    ).toBe(false);
    await waitFor(() => expect(count()).toHaveTextContent("1"));
    expect(screen.getByTestId("saved-tab-lists-title")).toHaveValue("");
  });

  it("sends a blank title as null", async () => {
    const user = userEvent.setup();
    mount();
    await open(user);
    await within(
      await screen.findByTestId("saved-tab-lists-runner-picker")
    ).findByRole("radio", { name: /merytshost/ });
    await user.type(screen.getByTestId("saved-tab-lists-title"), "   ");
    await user.click(screen.getByTestId("saved-tab-lists-save"));
    await screen.findByTestId("saved-tab-lists-saved");
    expect(net.calls.find((c) => c.method === "POST")?.body).toEqual({
      device_id: DEVICE_A,
      title: null,
    });
  });

  it.each(Object.keys(CAPTURE_REFUSALS))(
    "renders the %s refusal in its own words, and saves nothing",
    async (discriminator) => {
      const user = userEvent.setup();
      const refusal = CAPTURE_REFUSALS[discriminator];
      if (!refusal) throw new Error(`no fixture for ${discriminator}`);
      net.captureAnswer = refusal;
      mount();
      await waitFor(() => expect(count()).toHaveTextContent("0"));
      await open(user);
      await within(
        await screen.findByTestId("saved-tab-lists-runner-picker")
      ).findByRole("radio", { name: /merytshost/ });
      const readsBefore = listReads();
      await user.click(screen.getByTestId("saved-tab-lists-save"));

      const error = await screen.findByTestId("saved-tab-lists-save-error");
      const message = within(error).getByTestId("saved-tab-lists-save-refusal");
      expect(message).toHaveAttribute("data-refusal", "structured");
      expect(message).toHaveTextContent(`(${discriminator})`);
      const lead = within(error).queryByTestId("saved-tab-lists-save-lead");
      if (discriminator === "runner_predates_terminal_layout") {
        expect(lead).toHaveTextContent(
          "This runner's build predates saved tab lists — rebuild it to enable saving."
        );
        // The refusal's own next step stays: install a current runner.
        expect(message).toHaveAttribute(
          "data-refusal-next-action",
          "open_page"
        );
      } else {
        expect(lead).toBeNull();
        // The relay's own refusals are never mistaken for "runner predates".
        expect(error).not.toHaveTextContent(/predates/);
      }
      // A typed refusal is raised before anything is written: no re-read,
      // nothing added, and no hint that it might have saved.
      expect(listReads()).toBe(readsBefore);
      expect(count()).toHaveTextContent("0");
      expect(error).not.toHaveTextContent(/re-read/);
      expect(screen.queryByTestId("saved-tab-lists-saved")).toBeNull();
    }
  );

  it("re-reads the lists, rather than inviting a second save, when no answer came", async () => {
    const user = userEvent.setup();
    net.captureAnswer = new Error(
      "Request timeout - backend may be starting up. Please try again."
    );
    mount();
    await waitFor(() => expect(count()).toHaveTextContent("0"));
    await open(user);
    await within(
      await screen.findByTestId("saved-tab-lists-runner-picker")
    ).findByRole("radio", { name: /merytshost/ });
    const readsBefore = listReads();
    await user.click(screen.getByTestId("saved-tab-lists-save"));
    const error = await screen.findByTestId("saved-tab-lists-save-error");
    expect(
      within(error).getByTestId("saved-tab-lists-save-refusal")
    ).toHaveAttribute("data-refusal", "unstructured");
    expect(error).toHaveTextContent(/re-read rather than saving again/);
    await waitFor(() => expect(listReads()).toBe(readsBefore + 1));
  });
});

describe("the runner picker (D4)", () => {
  it("lists a disconnected device and a secondary, both disabled, with their reasons", async () => {
    const user = userEvent.setup();
    mount();
    await open(user);
    const picker = await screen.findByTestId("saved-tab-lists-runner-picker");
    const off = await within(picker).findByRole("radio", { name: /spaceship/ });
    expect(off).toBeDisabled();
    const offRow = picker.querySelector(`[data-device-id="${DEVICE_B}"]`);
    expect(offRow).toHaveTextContent(
      /runner not connected to the relay \(offline\)/
    );
    const secondary = within(picker).getByTestId(
      "saved-tab-lists-runner-secondary"
    );
    expect(secondary).toHaveTextContent("secondary :9877");
    expect(secondary).toHaveTextContent("not addressable over the relay");
    expect(within(secondary).getByRole("radio")).toBeDisabled();
    expect(
      within(picker).getByRole("radio", { name: /merytshost/ })
    ).toHaveAttribute(
      "data-ui-bridge-id",
      `sessions.saved-tab-lists.runner.${DEVICE_A}`
    );
  });

  it("makes no choice for the operator when two runners are connected", async () => {
    const user = userEvent.setup();
    net.runners = [
      runner({ id: DEVICE_A, hostname: "merytshost" }),
      runner({ id: DEVICE_C, hostname: "laptop" }),
    ];
    mount();
    await open(user);
    const picker = await screen.findByTestId("saved-tab-lists-runner-picker");
    const laptop = await within(picker).findByRole("radio", { name: /laptop/ });
    const save = screen.getByTestId("saved-tab-lists-save");
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute(
      "data-ui-bridge-id",
      "sessions.saved-tab-lists.save"
    );
    await user.click(laptop);
    expect(save).toBeEnabled();
    await user.click(save);
    await screen.findByTestId("saved-tab-lists-saved");
    expect(net.calls.find((c) => c.method === "POST")?.body).toEqual({
      device_id: DEVICE_C,
      title: null,
    });
  });

  it("says when the runners cannot be listed", async () => {
    const user = userEvent.setup();
    net.runnersAnswer = {
      status: 500,
      body: { detail: "coord is not reachable" },
    };
    mount();
    await open(user);
    expect(
      await screen.findByTestId("saved-tab-lists-runners-unknown")
    ).toHaveTextContent(/coord is not reachable/);
    expect(screen.getByTestId("saved-tab-lists-save")).toBeDisabled();
  });

  it("clears a choice that drops off the relay — never swaps in another runner", async () => {
    const user = userEvent.setup();
    net.runners = [
      runner({ id: DEVICE_A, hostname: "merytshost" }),
      runner({ id: DEVICE_C, hostname: "laptop" }),
    ];
    mount();
    await open(user);
    const picker = await screen.findByTestId("saved-tab-lists-runner-picker");
    await user.click(
      await within(picker).findByRole("radio", { name: /laptop/ })
    );
    // The chosen runner leaves the relay; merytshost is now the only one up.
    net.runners = [
      runner({ id: DEVICE_A, hostname: "merytshost" }),
      runner({
        id: DEVICE_C,
        hostname: "laptop",
        wsConnected: false,
        derivedStatus: "offline",
      }),
    ];
    await user.click(screen.getByRole("button", { name: "Refresh runners" }));
    await waitFor(() =>
      expect(
        within(picker).getByRole("radio", { name: /laptop/ })
      ).toBeDisabled()
    );
    expect(
      within(picker).getByRole("radio", { name: /merytshost/ })
    ).not.toBeChecked();
    expect(screen.getByTestId("saved-tab-lists-save")).toBeDisabled();
  });
});

describe("a saved list's detail", () => {
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    mount();
    await open(user);
    const [row] = await rows();
    if (!row) throw new Error("no row");
    await user.click(rowLine(row));
    return screen.findByTestId("saved-tab-list-detail");
  }

  it("groups terminals by tab in the runner's order, named per D2", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    const el = await openDetail(user);
    const tabs = await within(el).findAllByTestId("saved-tab-list-tab");
    expect(
      tabs.map(
        (t) =>
          within(t).getByTestId("saved-tab-list-tab-heading").firstChild
            ?.textContent
      )
    ).toEqual([
      "Build",
      "Review (1b1b1b1b)",
      "Review (2c2c2c2c)",
      "Tab 3d3d3d3d (name not reported)",
    ]);
    const terminalIds = (tab: HTMLElement) =>
      within(tab)
        .getAllByTestId("saved-tab-list-session")
        .map((s) => s.getAttribute("data-terminal-id"));
    expect(tabs.map(terminalIds)).toEqual([
      ["term-build-1", "term-build-2"],
      ["term-review-1"],
      ["term-review-2", "term-review-3"],
      ["term-shell-1"],
    ]);
    expect(el).toHaveTextContent(/in the runner's own order/);
  });

  it("collapses a run of empty tabs into one line, in the runner's order", async () => {
    const user = userEvent.setup();
    const pages = layoutPages();
    const [build, ...rest] = pages;
    if (!build) throw new Error("fixture");
    const empty = (pageId: string, label: string) => ({
      pageId,
      label,
      order: 0,
      sessions: [],
    });
    seedList(
      net,
      detail({
        id: "l1",
        layout: {
          ...detail({ id: "l1" }).layout,
          pages: [
            build,
            empty("e1e1e1e1-0", "Old 1"),
            empty("e2e2e2e2-0", "Old 2"),
            ...rest,
          ],
        },
      })
    );
    const el = await openDetail(user);
    await within(el).findAllByTestId("saved-tab-list-tab");
    const collapsed = within(el).getAllByTestId("saved-tab-list-empty-tabs");
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toHaveTextContent(
      "2 tabs with no terminals: Old 1, Old 2."
    );
    expect(collapsed[0]?.getAttribute("data-page-ids")).toBe(
      "e1e1e1e1-0 e2e2e2e2-0"
    );
    // Each tab keeps its own tooltip inside the line.
    expect(
      within(collapsed[0] as HTMLElement)
        .getAllByTestId("saved-tab-list-empty-tab")
        .map((t) => [t.textContent, t.getAttribute("title")])
    ).toEqual([
      ["Old 1", 'Tab "Old 1"'],
      ["Old 2", 'Tab "Old 2"'],
    ]);
    // It sits where those tabs sat: after Build, before the first Review.
    const blocks = within(el).getByTestId("saved-tab-list-tabs").children;
    expect(blocks[1]).toBe(collapsed[0]);
    expect(within(el).getAllByTestId("saved-tab-list-tab")).toHaveLength(4);
  });

  it("paints the /sessions finished badge per D3, naming its source", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    const el = await openDetail(user);
    await within(el).findAllByTestId("saved-tab-list-tab");
    const line = (id: string) => {
      const found = el.querySelector<HTMLElement>(`[data-terminal-id="${id}"]`);
      if (found === null) throw new Error(`no terminal ${id}`);
      return found;
    };
    const badge = (id: string) => line(id).querySelector("[data-status-kind]");

    expect(badge("term-build-1")).toHaveTextContent("✓ finished");
    expect(badge("term-build-1")).toHaveAttribute(
      "title",
      expect.stringMatching(/finished per the runner's finished marker/)
    );
    expect(badge("term-build-2")).toHaveAttribute(
      "title",
      expect.stringMatching(/finished per coord's session status/)
    );
    expect(badge("term-review-1")).toHaveAttribute(
      "title",
      expect.stringMatching(
        /runner's finished marker and coord's session status/
      )
    );
    // Neither source answered: unknown, with why.
    expect(badge("term-review-2")).toHaveAttribute(
      "data-status-kind",
      "unknown"
    );
    expect(badge("term-review-2")).toHaveAttribute(
      "title",
      expect.stringMatching(/coord could not be read/)
    );
    // Coord answered "working": nothing — there is no "not finished" badge.
    expect(badge("term-review-3")).toBeNull();
    expect(badge("term-shell-1")).toBeNull();
    expect(el).not.toHaveTextContent(/not finished/);
    expect(
      within(el).getByTestId("saved-tab-list-unknown-finished")
    ).toHaveTextContent(/Whether 1 session had finished is unknown/);
  });

  it("shows name, account, title (or 'title withheld') and alive/exited", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    const el = await openDetail(user);
    await within(el).findAllByTestId("saved-tab-list-tab");
    const line = (id: string) => {
      const found = el.querySelector<HTMLElement>(`[data-terminal-id="${id}"]`);
      if (found === null) throw new Error(`no terminal ${id}`);
      return found;
    };
    const part = (id: string, testId: string) =>
      within(line(id)).getByTestId(testId);

    expect(
      part("term-build-1", "saved-tab-list-session-name")
    ).toHaveTextContent("brave-otter");
    expect(
      part("term-build-1", "saved-tab-list-session-account")
    ).toHaveTextContent("work");
    expect(
      part("term-build-1", "saved-tab-list-session-title")
    ).toHaveTextContent("cargo build");
    expect(
      part("term-build-2", "saved-tab-list-session-process")
    ).toHaveTextContent("exited");
    expect(
      part("term-build-1", "saved-tab-list-session-process")
    ).toHaveTextContent("alive");
    expect(
      part("term-review-1", "saved-tab-list-session-title")
    ).toHaveTextContent("title withheld");
    expect(
      part("term-review-2", "saved-tab-list-session-name")
    ).toHaveTextContent("name not reported");
    expect(
      part("term-review-2", "saved-tab-list-session-account")
    ).toHaveTextContent("account unknown");
    expect(
      part("term-shell-1", "saved-tab-list-session-name")
    ).toHaveTextContent("shell-1 · no confirmed session");
    expect(line("term-build-1")).toHaveAttribute(
      "data-ui-bridge-id",
      "sessions.saved-tab-lists.session.term-build-1"
    );
  });

  it("says when the runner had not reported its tab names", async () => {
    const user = userEvent.setup();
    const d = detail({ id: "l1" });
    seedList(net, { ...d, layout: { ...d.layout, labelsRegistered: false } });
    const el = await openDetail(user);
    expect(
      await within(el).findByTestId("saved-tab-list-labels-unreported")
    ).toHaveTextContent(/had not reported its tab names/);
  });

  it("reads a list that has since gone as gone, not as an outage", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    net.details.delete("l1");
    const el = await openDetail(user);
    expect(
      await within(el).findByTestId("saved-tab-list-gone")
    ).toHaveTextContent(/no longer available: it expired or was deleted/);
    expect(within(el).queryByTestId("saved-tab-list-read-failed")).toBeNull();
  });

  it("reads a failed layout read as unknown — not empty, and not gone", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    net.getAnswer = { status: 502, body: { message: "upstream_error" } };
    const el = await openDetail(user);
    const failed = await within(el).findByTestId("saved-tab-list-read-failed");
    expect(failed).toHaveTextContent(/its tabs are unknown — not empty/);
    expect(failed).toHaveTextContent(/upstream_error/);
    expect(within(el).queryByTestId("saved-tab-list-gone")).toBeNull();
    expect(within(el).queryByTestId("saved-tab-list-tabs")).toBeNull();
    // Copy needs the layout; Delete does not.
    expect(within(el).getByTestId("saved-tab-list-copy")).toBeDisabled();
    expect(within(el).getByTestId("saved-tab-list-delete")).toBeEnabled();
  });

  it("copies the whole list as Markdown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    seedList(net, detail({ id: "l1", title: "Before rebuild" }));
    const el = await openDetail(user);
    await within(el).findAllByTestId("saved-tab-list-tab");
    await user.click(within(el).getByTestId("saved-tab-list-copy"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const markdown = writeText.mock.calls[0]?.[0] ?? "";
    expect(markdown).toMatch(/^# Saved tab list: Before rebuild$/m);
    expect(markdown).toMatch(/^## Build$/m);
    expect(markdown).toMatch(/^- Runner: merytshost /m);
    await waitFor(() =>
      expect(
        within(el).getByTestId("saved-tab-list-copy-state")
      ).toHaveTextContent("Copied.")
    );
  });

  it("deletes after a confirm, and the row and its count go with it", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    seedList(net, detail({ id: "l2" }));
    const el = await openDetail(user);
    await waitFor(() => expect(count()).toHaveTextContent("2"));
    const del = within(el).getByTestId("saved-tab-list-delete");
    expect(del).toHaveAttribute(
      "data-ui-bridge-id",
      "sessions.saved-tab-lists.delete"
    );
    await user.click(del);
    // Nothing is deleted until the confirm.
    expect(net.calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(
      await screen.findByTestId("saved-tab-list-delete-dialog-confirm")
    );
    await waitFor(() =>
      expect(
        net.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/l1"))
      ).toBe(true)
    );
    await waitFor(async () => {
      const remaining = await rows();
      expect(remaining.map((r) => r.getAttribute("data-row-key"))).toEqual([
        "l2",
      ]);
    });
    expect(count()).toHaveTextContent("1");
  });

  it("keeps the list and says why when the delete is refused", async () => {
    const user = userEvent.setup();
    seedList(net, detail({ id: "l1" }));
    net.deleteAnswer = {
      status: 500,
      body: { message: "database unavailable" },
    };
    const el = await openDetail(user);
    await user.click(within(el).getByTestId("saved-tab-list-delete"));
    await user.click(
      await screen.findByTestId("saved-tab-list-delete-dialog-confirm")
    );
    const error = await within(el).findByTestId("saved-tab-list-delete-error");
    expect(error).toHaveTextContent(/The list was not deleted/);
    expect(error).toHaveTextContent(/database unavailable/);
    expect(await rows()).toHaveLength(1);
  });
});
