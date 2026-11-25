/**
 * PolicyUpstreamDialControl — what the operator can read off the dial, and
 * what it refuses to do on one click.
 *
 * The hook's own tests (`usePolicyUpstreamPolicy.test.ts`) pin the resolution
 * rules. These pin the two things only the rendered control can get wrong:
 *
 * 1. **Every state the dial can be in is NAMED.** coord's served no-row
 *    default, a no-row default this console cannot parse (vocabulary skew), a
 *    row coord cannot parse, a narrower band overriding the tenant row this
 *    control writes, a write whose read-back failed. Each is a case where the
 *    level alone would leave the operator believing something wrong that
 *    nothing else on the page corrects.
 * 2. **`auto` is not applied on a single click.** It is the only level at
 *    which a document here changes without anyone here clicking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { PINNED_PAGE, sectionRenderer } from "../__fixtures__/pageWriteGuard";

import userEvent from "@testing-library/user-event";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    // The hooks call `httpClient.fetch` (the typed /operations client); route
    // each request onto the per-verb mock the assertions below read.
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method ?? "GET";
      const body = JSON.parse(init.body ?? "null");
      let out: unknown;
      if (method === "GET") out = await getMock(url);
      else if (method === "PUT") out = await putMock(url, body);
      else throw new Error(`fetch mock: unexpected ${method} ${url}`);
      // A mock that resolves a `Response` (an error path) is answered
      // as-is, so a non-2xx goes through `readJson` like the real one.
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { PolicyUpstreamDialControl } from "./PolicyUpstreamDialControl";

// A section mounted on its own, under the page's guard once its project is
// known: the hooks it uses require one, and a settings section reads only
// under the page's pin (`__fixtures__`).
const renderSection = sectionRenderer(PINNED_PAGE);

function view(over: Partial<FleetPolicyView> = {}): FleetPolicyView {
  return {
    domain: "policy_upstream",
    effective_level: "notify",
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    ...over,
  };
}

/** A read the test holds in flight, and settles itself before it ends. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function okWrite(
  effective: FleetPolicyView | null,
  readbackError: string | null = null
) {
  return {
    ok: true,
    domain: "policy_upstream",
    written_level: "auto",
    written_master_enabled: true,
    versioned: true,
    version: 1,
    updated_by: "operator@example.com",
    effective,
    readback_error: readbackError,
  };
}

beforeEach(() => {
  // `mockReset`, not `clearAllMocks`: a test that fails before using up its
  // queued once-values must not leave them for the next test's first GET.
  // Only these two, so the global `matchMedia` stub keeps its implementation.
  getMock.mockReset();
  putMock.mockReset();
});

describe("PolicyUpstreamDialControl — names every state it can be in", () => {
  it("labels a missing row as coord's built-in default, not as off", async () => {
    getMock.mockResolvedValue(
      // With no row coord serves its typed default (qontinui-coord#4239).
      view({
        effective_level: "auto",
        master_enabled: false,
        resolved_scope: "none",
      })
    );

    renderSection(<PolicyUpstreamDialControl />);

    // Scoped to the readout, because the level list describes `auto` too.
    const inForce = await screen.findByTestId("policy-upstream-in-force");
    expect(inForce).toHaveTextContent(/^In force:\s*auto/);
    expect(inForce).toHaveTextContent(/built-in default \(auto\)/i);
    expect(inForce).toHaveTextContent(/no one has set this tenant/i);
    expect(screen.getByLabelText(/^auto/)).toBeChecked();
  });

  it("labels whatever default coord serves, not a console copy of it", async () => {
    // Not the old console constant (`auto`): a revert to a hardcoded default
    // fails this.
    getMock.mockResolvedValue(
      view({
        effective_level: "notify",
        master_enabled: false,
        resolved_scope: "none",
      })
    );

    renderSection(<PolicyUpstreamDialControl />);

    const inForce = await screen.findByTestId("policy-upstream-in-force");
    expect(inForce).toHaveTextContent(/^In force:\s*notify/);
    expect(inForce).toHaveTextContent(/built-in default \(notify\)/i);
    expect(screen.getByLabelText(/^notify/)).toBeChecked();
  });

  it("shows a no-row default it cannot parse as unknown, never as off", async () => {
    getMock.mockResolvedValue(
      view({
        effective_level: "automatic",
        master_enabled: false,
        resolved_scope: "none",
      })
    );

    renderSection(<PolicyUpstreamDialControl />);

    const banner = await screen.findByTestId(
      "policy-upstream-unrecognized-level"
    );
    expect(banner).toHaveTextContent("automatic");
    expect(banner).toHaveTextContent(/no row is set/i);
    // With no row coord enforces its own default; the console just cannot
    // name it, so it must not claim `off`.
    const inForce = screen.getByTestId("policy-upstream-in-force");
    expect(inForce).toHaveTextContent(/^In force:\s*unknown/);
    expect(inForce).toHaveTextContent(/cannot be shown here/i);
    expect(inForce).not.toHaveTextContent(/fail-closed/i);
    expect(inForce).not.toHaveTextContent(/no one has set/i);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
  });

  it("names an unparseable row, and shows the level coord actually enforces", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "automatic", resolved_scope: "tenant" })
    );

    renderSection(<PolicyUpstreamDialControl />);

    const banner = await screen.findByTestId(
      "policy-upstream-unrecognized-level"
    );
    // The raw stored value, so the operator knows which row to fix...
    expect(banner).toHaveTextContent("automatic");
    expect(banner).toHaveTextContent(/rewrites that row and clears this/i);
    // ...and the readout shows what the fleet enforces, not what it stores.
    const inForce = screen.getByTestId("policy-upstream-in-force");
    expect(inForce).toHaveTextContent(/^In force:\s*off/);
    expect(inForce).toHaveTextContent(/fail-closed/i);
    expect(inForce).not.toHaveTextContent("automatic");
    expect(screen.getByLabelText(/^off/)).toBeChecked();
  });

  it("does not promise to fix an unparseable row this control cannot write", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "automatic", resolved_scope: "repo" })
    );

    renderSection(<PolicyUpstreamDialControl />);

    const banner = await screen.findByTestId(
      "policy-upstream-unrecognized-level"
    );
    // The control writes the tenant band only, so it must not claim that
    // picking a level clears a broken REPO row.
    expect(banner).toHaveTextContent(/cannot rewrite that row/i);
    expect(banner).not.toHaveTextContent(/rewrites that row and clears this/i);
  });

  it("reads a master-disabled row as off, set at its band", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "off", master_enabled: false })
    );

    renderSection(<PolicyUpstreamDialControl />);

    const inForce = await screen.findByTestId("policy-upstream-in-force");
    expect(inForce).toHaveTextContent(/^In force:\s*off/);
    expect(inForce).toHaveTextContent(/master disabled/i);
    expect(inForce).not.toHaveTextContent(/built-in default/i);
  });

  it("says the level is unknown, not off, when the very first read fails", async () => {
    getMock.mockImplementation(
      async () => new Response("coord is not reachable", { status: 502 })
    );

    renderSection(<PolicyUpstreamDialControl />);

    expect(
      await screen.findByText(/the level in force is unknown — it is not off/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("policy-upstream-in-force")
    ).not.toBeInTheDocument();
  });

  it("warns when a repo-band row overrides the tenant row this control writes", async () => {
    getMock.mockResolvedValue(view({ resolved_scope: "repo" }));

    renderSection(<PolicyUpstreamDialControl />);

    const banner = await screen.findByTestId(
      "policy-upstream-overridden-by-repo"
    );
    expect(banner).toHaveTextContent(/keeps.*overriding/i);
    expect(
      screen.queryByTestId("policy-upstream-system-fallback")
    ).not.toBeInTheDocument();
  });

  it("says a write takes effect when only a system-band row is answering", async () => {
    getMock.mockResolvedValue(view({ resolved_scope: "system" }));

    renderSection(<PolicyUpstreamDialControl />);

    const note = await screen.findByTestId("policy-upstream-system-fallback");
    expect(note).toHaveTextContent(/takes effect immediately/i);
  });

  it("accounts for control blocks coord returned but this view does not carry", async () => {
    getMock.mockResolvedValue(
      view({
        keys_not_shown: ["controls", "drain"],
        keys_not_shown_source: "fleet_resources_row",
      })
    );

    renderSection(<PolicyUpstreamDialControl />);

    const note = await screen.findByTestId("policy-upstream-keys-not-shown");
    expect(note).toHaveTextContent("controls, drain");
    expect(note).toHaveTextContent(/fleet_resources/);
  });

  it("names what was written beside a read-back that failed", async () => {
    // The write's failed read-back sends a re-read; it is held, so the dial
    // is seen while coord's level is still unknown.
    const reread = deferred<FleetPolicyView>();
    getMock
      .mockResolvedValueOnce(view({ effective_level: "auto" }))
      .mockReturnValueOnce(reread.promise);
    putMock.mockResolvedValue({
      ...okWrite(null, "coord returned 502"),
      written_level: "notify",
    });

    const user = userEvent.setup();
    renderSection(<PolicyUpstreamDialControl />);
    await screen.findByTestId("policy-upstream-in-force");

    await user.click(screen.getByLabelText(/^notify/));

    const banner = await screen.findByTestId("policy-upstream-readback-error");
    // Both halves: the write that landed, and the resolution that is unknown.
    expect(banner).toHaveTextContent("notify");
    expect(banner).toHaveTextContent(/unknown/i);
    // The readout keeps the last level coord CONFIRMED, never the written one.
    expect(screen.getByTestId("policy-upstream-in-force")).toHaveTextContent(
      /^In force:\s*auto/
    );

    // Coord answers the re-read: the banner goes, and its level is shown.
    reread.resolve(view({ effective_level: "notify" }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("policy-upstream-readback-error")
      ).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("policy-upstream-in-force")).toHaveTextContent(
      /^In force:\s*notify/
    );
  });

  it("keeps the last level beside both warnings when the re-read after a failed read-back fails", async () => {
    getMock
      .mockResolvedValueOnce(view({ effective_level: "auto" }))
      .mockResolvedValueOnce(
        new Response("coord is not reachable", { status: 502 })
      );
    putMock.mockResolvedValue({
      ...okWrite(null, "coord returned 502"),
      written_level: "notify",
    });

    const user = userEvent.setup();
    renderSection(<PolicyUpstreamDialControl />);
    await screen.findByTestId("policy-upstream-in-force");

    await user.click(screen.getByLabelText(/^notify/));

    // The re-read failed: the read error, the read-back warning, and the last
    // level coord confirmed — never the written one.
    expect(
      await screen.findByText("Could not read the dial.")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("policy-upstream-readback-error")
    ).toHaveTextContent("notify");
    expect(screen.getByTestId("policy-upstream-in-force")).toHaveTextContent(
      /^In force:\s*auto/
    );
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

describe("PolicyUpstreamDialControl — auto is confirmed", () => {
  it("does not write auto on the first click", async () => {
    getMock.mockResolvedValue(view());

    const user = userEvent.setup();
    renderSection(<PolicyUpstreamDialControl />);
    await screen.findByTestId("policy-upstream-in-force");

    await user.click(screen.getByLabelText(/^auto/));

    const dialog = await screen.findByTestId("policy-upstream-confirm");
    // The confirmation states what it does NOT do, which is the half that
    // makes `auto` safe to choose.
    expect(dialog).toHaveTextContent(
      /does not touch a document you have edited/i
    );
    expect(putMock).not.toHaveBeenCalled();
  });

  it("leaves the fleet untouched when the confirmation is cancelled", async () => {
    getMock.mockResolvedValue(view());

    const user = userEvent.setup();
    renderSection(<PolicyUpstreamDialControl />);
    await screen.findByTestId("policy-upstream-in-force");

    await user.click(screen.getByLabelText(/^auto/));
    await screen.findByTestId("policy-upstream-confirm");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("policy-upstream-confirm")
      ).not.toBeInTheDocument()
    );
    expect(putMock).not.toHaveBeenCalled();
    // The selection is controlled by what the fleet resolves, so a cancelled
    // confirmation must not leave the radio sitting on a level nobody set.
    expect(screen.getByLabelText(/^notify/)).toBeChecked();
  });

  it("writes auto once confirmed", async () => {
    getMock.mockResolvedValue(view());
    putMock.mockResolvedValue(okWrite(view({ effective_level: "auto" })));

    const user = userEvent.setup();
    renderSection(<PolicyUpstreamDialControl />);
    await screen.findByTestId("policy-upstream-in-force");

    await user.click(screen.getByLabelText(/^auto/));
    await screen.findByTestId("policy-upstream-confirm");
    await user.click(screen.getByRole("button", { name: /set to auto/i }));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0][1].level).toBe("auto");
  });

  it("applies a narrowing level immediately — only auto is confirmed", async () => {
    getMock.mockResolvedValue(view({ effective_level: "auto" }));
    putMock.mockResolvedValue({
      ...okWrite(view({ effective_level: "off" })),
      written_level: "off",
    });

    const user = userEvent.setup();
    renderSection(<PolicyUpstreamDialControl />);
    await screen.findByTestId("policy-upstream-in-force");

    await user.click(screen.getByLabelText(/^off/));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0][1].level).toBe("off");
    expect(
      screen.queryByTestId("policy-upstream-confirm")
    ).not.toBeInTheDocument();
  });
});
