/**
 * /admin/coord/taste — the operator's sequence against an in-memory server.
 *
 * The client module is replaced by a small fake that keeps a real queue
 * (same order rule as the backend: never-skipped first, then skipped ones,
 * least recently skipped first), so what these tests read off the page is
 * what a re-read of that queue says — the property plan Phase 23's gate
 * names: label a pair, skip one, mark both bad, refresh, and the queue
 * neither drops nor duplicates a row.
 *
 * The keys are pressed ON THE PAIR CARD: the shortcuts are scoped to it
 * (WCAG 2.1.4), and a key anywhere else on the page does nothing.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TasteInbox,
  TasteLabelWrite,
  TastePair,
  TasteReason,
} from "@/lib/api/taste";
import { backendError } from "@/lib/errors/backend-error-message";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const VOCAB: TasteReason[] = [
  "on_style",
  "off_style",
  "off_palette",
  "composition",
  "cropping",
  "wrong_subject",
  "too_busy",
  "text_in_image",
  "artifacts",
  "low_quality",
];

interface Row extends TastePair {
  skipOrder: number | null;
}

/** The viewer's user id, and a colleague's. */
const ME = "user-me";
const COLLEAGUE = "user-colleague";

const server = {
  rows: [] as Row[],
  canLabel: true,
  weeklyBudget: 30,
  labelledThisWeek: 0,
  skipClock: 0,
  /** When set, the next label write is answered first by this labeller. */
  raceLabeller: null as string | null,
  inboxCalls: [] as { limit: number; overBudget: boolean }[],
};

function image(sha: string) {
  return {
    sha256: sha,
    kind: "candidate" as const,
    mime_type: "image/png",
    width: 64,
    height: 48,
    byte_size: 10,
    direction: null,
  };
}

function seed(n: number) {
  server.rows = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    repo: null,
    slot_id: null,
    source: "calibration" as const,
    uncertainty: null,
    context: {},
    asset_a: image(`${i}a`.padEnd(64, "0")),
    asset_b: image(`${i}b`.padEnd(64, "0")),
    capture_a_sha256: null,
    capture_b_sha256: null,
    in_situ: false,
    pushed_by: "operator",
    skipped_at: null,
    skip_count: 0,
    label: null,
    reasons: [],
    comment: null,
    edit_note: null,
    edit_asset_sha256: null,
    labeller_user_id: null,
    labeller_name: null,
    labelled_at: null,
    first_labelled_at: null,
    change_seq: null,
    tombstone: false,
    removal: null,
    created_at: `2026-10-15T10:0${i}:00Z`,
    updated_at: `2026-10-15T10:0${i}:00Z`,
    skipOrder: null,
  }));
}

function pending(): Row[] {
  return server.rows
    .filter((r) => r.label === null)
    .sort((x, y) => {
      if ((x.skipOrder === null) !== (y.skipOrder === null))
        return x.skipOrder === null ? -1 : 1;
      if (x.skipOrder !== null && y.skipOrder !== null)
        return x.skipOrder - y.skipOrder;
      return x.created_at.localeCompare(y.created_at);
    });
}

let labelClock = 0;

function inbox(limit: number, overBudget: boolean): TasteInbox {
  const remaining = Math.max(0, server.weeklyBudget - server.labelledThisWeek);
  const headLimit = overBudget ? limit : Math.min(limit, remaining);
  const labelled = server.rows
    .filter((r) => r.label !== null)
    .sort((x, y) => (y.labelled_at ?? "").localeCompare(x.labelled_at ?? ""));
  return {
    budget: {
      weekly_budget: server.weeklyBudget,
      source: "default",
      week_starts_at: "2026-10-12T00:00:00Z",
      labelled_this_week: server.labelledThisWeek,
      remaining,
    },
    pending_total: pending().length,
    labelled_total: labelled.length,
    viewer_user_id: ME,
    over_budget: overBudget,
    pairs: pending().slice(0, headLimit),
    recent: labelled.slice(0, 10),
    pool: { images: 0, directions: [] },
    can_label: server.canLabel,
    reason_vocabulary: VOCAB,
  };
}

function refusal(status: number, error: string) {
  return backendError(
    new Response(JSON.stringify({ error, message: error }), { status })
  );
}

const api = vi.hoisted(() => ({
  fetchTasteInbox: vi.fn(),
  labelTastePair: vi.fn(),
  undoTasteLabel: vi.fn(),
  skipTastePair: vi.fn(),
  buildCalibrationBatch: vi.fn(),
  writeTasteBudget: vi.fn(),
  uploadReferenceImage: vi.fn(),
  fetchImageBlob: vi.fn(),
}));
vi.mock("@/lib/api/taste", () => api);

import TasteInboxPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  seed(4);
  server.canLabel = true;
  server.weeklyBudget = 30;
  server.labelledThisWeek = 0;
  server.raceLabeller = null;
  server.inboxCalls = [];
  labelClock = 0;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn();
  api.fetchImageBlob.mockResolvedValue(new Blob(["x"]));
  api.fetchTasteInbox.mockImplementation(
    async (o: { limit: number; overBudget: boolean }) => {
      server.inboxCalls.push(o);
      return structuredClone(inbox(o.limit, o.overBudget));
    }
  );
  api.labelTastePair.mockImplementation(
    async (id: string, body: TasteLabelWrite) => {
      const row = server.rows.find((r) => r.id === id);
      if (!row) throw await refusal(404, "taste_pair_not_found");
      if (server.raceLabeller) {
        Object.assign(row, {
          label: "b",
          labeller_user_id: COLLEAGUE,
          labeller_name: server.raceLabeller,
          labelled_at: `2026-10-15T11:00:${String(labelClock++).padStart(2, "0")}Z`,
        });
        server.raceLabeller = null;
      }
      if (row.label !== null && !body.relabel)
        throw await refusal(409, "pair_already_labelled");
      Object.assign(row, {
        label: body.choice,
        reasons: body.reasons ?? [],
        comment: body.comment ?? null,
        edit_note: body.edit_note ?? null,
        labeller_user_id: ME,
        labeller_name: "Operator",
        labelled_at: `2026-10-15T11:00:${String(labelClock++).padStart(2, "0")}Z`,
        skipOrder: null,
      });
      server.labelledThisWeek += 1;
      return structuredClone(row);
    }
  );
  api.skipTastePair.mockImplementation(async (id: string) => {
    const row = server.rows.find((r) => r.id === id)!;
    row.skipOrder = ++server.skipClock;
    row.skip_count += 1;
    row.skipped_at = "2026-10-15T11:30:00Z";
    return structuredClone(row);
  });
  api.undoTasteLabel.mockImplementation(
    async (id: string, options: { force: boolean }) => {
      const row = server.rows.find((r) => r.id === id)!;
      if (row.label === null) throw await refusal(409, "pair_not_labelled");
      if (row.labeller_user_id !== ME && !options.force)
        throw await refusal(409, "label_not_yours");
      Object.assign(row, {
        label: null,
        reasons: [],
        labelled_at: null,
        labeller_user_id: null,
        labeller_name: null,
      });
      server.labelledThisWeek -= 1;
      return structuredClone(row);
    }
  );
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function headId(): string | null {
  return (
    screen.queryByTestId("taste-pair-card")?.getAttribute("data-pair-id") ??
    null
  );
}

function card(): HTMLElement {
  return screen.getByTestId("taste-pair-card");
}

/** Press a key on `target` — the pair card unless said otherwise. */
async function press(
  key: string,
  target?: EventTarget,
  init: { repeat?: boolean } = {}
) {
  await act(async () => {
    fireEvent.keyDown(target ?? card(), { key, ...init });
  });
}

/** Press a key wherever focus REALLY is — no target chosen by the test. */
async function pressFocused(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
}

/** A colleague answered `id` after the viewer's labels. */
function colleagueLabels(id: string) {
  const row = server.rows.find((r) => r.id === id)!;
  Object.assign(row, {
    label: "b",
    labeller_user_id: COLLEAGUE,
    labeller_name: "Colleague",
    labelled_at: "2026-10-15T12:00:00Z",
  });
}

async function settle(expectedHead: string | null) {
  await waitFor(() => expect(headId()).toBe(expectedHead));
}

describe("the taste inbox", () => {
  it("label, skip, both bad, refresh: the queue neither drops nor duplicates a pair", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    expect(screen.getByTestId("taste-bare-notice").textContent).toMatch(
      /Shown bare/
    );

    await press("1"); // on_style
    await press("a");
    await settle("p2");
    expect(api.labelTastePair).toHaveBeenLastCalledWith("p1", {
      choice: "a",
      reasons: ["on_style"],
      comment: null,
      edit_note: null,
      relabel: false,
      force: false,
    });

    await press("s");
    await settle("p3");
    await press("x");
    await settle("p4");

    fireEvent.click(screen.getByTestId("taste-refresh"));
    await settle("p4");

    // The server's queue: p4 next, the skipped p2 after it; p1 and p3 answered.
    expect(pending().map((r) => r.id)).toEqual(["p4", "p2"]);
    const answered = server.rows.filter((r) => r.label !== null);
    expect(answered.map((r) => [r.id, r.label])).toEqual([
      ["p1", "a"],
      ["p3", "both_bad"],
    ]);
    // Every pair exactly once across the queue and the answers.
    const all = [...pending().map((r) => r.id), ...answered.map((r) => r.id)];
    expect(new Set(all).size).toBe(4);
    expect(all).toHaveLength(4);
    // And the page shows that state: both answers in the recent list, once.
    expect(screen.getByTestId("taste-recent-p1")).toBeTruthy();
    expect(screen.getByTestId("taste-recent-p3")).toBeTruthy();
    expect(screen.getAllByTestId(/^taste-recent-p\d$/)).toHaveLength(2);
    expect(screen.getByTestId("taste-health-queue").textContent).toBe(
      "queue 2"
    );
  });

  it("typing a comment never labels; Escape leaves the field and the comment rides the label", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    const comment = screen.getByTestId("taste-comment");
    await press("c");
    expect(document.activeElement).toBe(comment);
    fireEvent.change(comment, { target: { value: "a b x s" } });
    await press("a", comment);
    await press("x", comment);
    expect(api.labelTastePair).not.toHaveBeenCalled();
    await press("Escape", comment);
    // Back on the card, so the next key reaches it.
    expect(document.activeElement).toBe(card());
    await press("b");
    await settle("p2");
    expect(api.labelTastePair).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ choice: "b", comment: "a b x s" })
    );
  });

  it("u undoes YOUR newest label, never a colleague's newer one", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    await press("a");
    await settle("p2");
    colleagueLabels("p3"); // newer than p1, and not the viewer's
    fireEvent.click(screen.getByTestId("taste-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("taste-recent-p3")).toBeTruthy()
    );
    await press("u");
    await settle("p1");
    expect(api.undoTasteLabel).toHaveBeenCalledTimes(1);
    expect(api.undoTasteLabel).toHaveBeenCalledWith("p1", { force: false });
    expect(server.rows.find((r) => r.id === "p3")!.label).toBe("b");
    expect(screen.queryByTestId("taste-recent-p1")).toBeNull();
  });

  it("u still undoes after the queue runs dry: the empty panel hosts the keys", async () => {
    seed(1);
    render(<TasteInboxPage />);
    await settle("p1");
    await press("a");
    const region = await screen.findByTestId("taste-done-region");
    expect(screen.getByTestId("taste-queue-empty")).toBeTruthy();
    expect(screen.getByTestId("taste-shortcuts-hint").textContent).toMatch(
      /u undoes your newest label/
    );
    await press("u", region);
    await settle("p1");
    expect(api.undoTasteLabel).toHaveBeenCalledWith("p1", { force: false });
  });

  it("u undoes from the budget-spent panel too, and the toggle still governs it", async () => {
    seed(2);
    server.weeklyBudget = 1;
    render(<TasteInboxPage />);
    await settle("p1");
    await press("a");
    const region = await screen.findByTestId("taste-done-region");
    expect(screen.getByTestId("taste-budget-spent")).toBeTruthy();
    fireEvent.click(screen.getByTestId("taste-shortcuts-toggle"));
    await press("u", region);
    expect(api.undoTasteLabel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("taste-shortcuts-toggle"));
    await press("u", window);
    expect(api.undoTasteLabel).not.toHaveBeenCalled();
    await press("u", region);
    await settle("p1");
    expect(api.undoTasteLabel).toHaveBeenCalledWith("p1", { force: false });
  });

  it("focus follows the answer across the swap, both ways", async () => {
    seed(1);
    render(<TasteInboxPage />);
    await settle("p1");
    act(() => card().focus());
    expect(document.activeElement).toBe(card());

    await pressFocused("a"); // the last pair: the card gives way to the panel
    const region = await screen.findByTestId("taste-done-region");
    await waitFor(() => expect(document.activeElement).toBe(region));

    await pressFocused("u"); // the undo brings the pair back
    await settle("p1");
    await waitFor(() => expect(document.activeElement).toBe(card()));
    expect(api.undoTasteLabel).toHaveBeenCalledWith("p1", { force: false });
  });

  it("a keyboard answer that swaps nothing leaves no mark for a later, unrelated swap", async () => {
    seed(2);
    render(<TasteInboxPage />);
    await settle("p1");
    act(() => card().focus());
    await pressFocused("a"); // p2 still waits: the card stays, no swap
    await settle("p2");
    expect(document.activeElement).toBe(card());
    act(() => card().blur()); // the operator leaves the card
    expect(document.activeElement).toBe(document.body);
    colleagueLabels("p2"); // the queue empties elsewhere
    fireEvent.click(screen.getByTestId("taste-refresh"));
    const region = await screen.findByTestId("taste-done-region");
    await act(async () => {});
    expect(document.activeElement).not.toBe(region);
    expect(document.activeElement).toBe(document.body);
  });

  it("a u that is refused leaves no mark for a later swap either", async () => {
    seed(2);
    render(<TasteInboxPage />);
    await settle("p1");
    act(() => card().focus());
    await pressFocused("a");
    await settle("p2");
    // Undone elsewhere: the page still lists p1 as the viewer's, so u 409s.
    Object.assign(server.rows.find((r) => r.id === "p1")!, {
      label: null,
      labelled_at: null,
      labeller_user_id: null,
    });
    await pressFocused("u");
    await settle("p1"); // the re-read shows p1 back at the head: no swap
    expect(api.undoTasteLabel).toHaveBeenCalledTimes(1);
    act(() => card().blur());
    colleagueLabels("p1");
    colleagueLabels("p2");
    fireEvent.click(screen.getByTestId("taste-refresh"));
    const region = await screen.findByTestId("taste-done-region");
    await act(async () => {});
    expect(document.activeElement).not.toBe(region);
  });

  it("focus the operator put elsewhere is never taken by the swap", async () => {
    seed(1);
    render(<TasteInboxPage />);
    await settle("p1");
    fireEvent.click(screen.getByTestId("taste-choose-a")); // a click, not a key
    await screen.findByTestId("taste-done-region");
    const row = screen.getByTestId("taste-recent-p1");
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    const undoButton = await screen.findByTestId("taste-undo-p1");
    act(() => undoButton.focus());
    fireEvent.click(undoButton);
    await settle("p1");
    expect(document.activeElement).not.toBe(card());
  });

  it("u does nothing when every recent label is a colleague's", async () => {
    colleagueLabels("p4");
    render(<TasteInboxPage />);
    await settle("p1");
    expect(screen.getByTestId("taste-shortcuts-hint").textContent).not.toMatch(
      /u undoes/
    );
    await press("u");
    expect(api.undoTasteLabel).not.toHaveBeenCalled();
  });

  it("removing a colleague's label asks first, names them, and sends force", async () => {
    colleagueLabels("p4");
    render(<TasteInboxPage />);
    await settle("p1");
    const row = screen.getByTestId("taste-recent-p4");
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    const remove = await screen.findByTestId("taste-undo-p4");
    expect(remove.textContent).toMatch(/Remove Colleague's label/);
    fireEvent.click(remove);
    expect(api.undoTasteLabel).not.toHaveBeenCalled();
    expect(screen.getByTestId("taste-force-confirm-p4").textContent).toMatch(
      /recorded as forced/
    );
    fireEvent.click(screen.getByTestId("taste-force-undo-p4"));
    await waitFor(() =>
      expect(api.undoTasteLabel).toHaveBeenCalledWith("p4", { force: true })
    );
  });

  it("keys act only while the pair card has focus", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    await press("a", window);
    await press("s", document.body);
    expect(api.labelTastePair).not.toHaveBeenCalled();
    expect(api.skipTastePair).not.toHaveBeenCalled();
  });

  it("the shortcut toggle turns every key off, and the hints with it", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    expect(within(card()).getAllByText("x")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("taste-shortcuts-toggle"));
    expect(screen.getByTestId("taste-shortcuts-hint").textContent).toMatch(
      /Shortcuts are off/
    );
    expect(within(card()).queryAllByText("x")).toHaveLength(0);
    await press("a");
    await press("1");
    expect(api.labelTastePair).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("coord-taste-shortcuts")).toBe("off");
  });

  it("a held key answers once: auto-repeat is ignored", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    await press("a", undefined, { repeat: true });
    expect(api.labelTastePair).not.toHaveBeenCalled();
  });

  it("a double press while a label is in flight sends one write", async () => {
    let release: () => void = () => {};
    const original = api.labelTastePair.getMockImplementation()!;
    api.labelTastePair.mockImplementation(
      async (id: string, body: TasteLabelWrite) => {
        await new Promise<void>((resolve) => (release = resolve));
        return original(id, body);
      }
    );
    render(<TasteInboxPage />);
    await settle("p1");
    await act(async () => {
      fireEvent.keyDown(card(), { key: "a" });
      fireEvent.keyDown(card(), { key: "b" });
    });
    await act(async () => release());
    await settle("p2");
    expect(api.labelTastePair).toHaveBeenCalledTimes(1);
    expect(server.rows.find((r) => r.id === "p1")!.label).toBe("a");
  });

  it("the budget field keeps a number being typed across a re-read", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    const input = screen.getByTestId("taste-budget-input") as HTMLInputElement;
    expect(input.value).toBe("30");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("taste-refresh"));
    await waitFor(() => expect(server.inboxCalls.length).toBeGreaterThan(1));
    await act(async () => {});
    expect(input.value).toBe("12");
  });

  it("a reference upload the store already held as a capture is not called a pool image", async () => {
    api.uploadReferenceImage.mockResolvedValue({ kind: "capture" });
    render(<TasteInboxPage />);
    await settle("p1");
    const file = new File(["x"], "ref.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("taste-reference-input"), {
      target: { files: [file] },
    });
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "1 image was already stored as a capture, so it stays out of the pool."
      )
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a pair someone else answered first is re-read, not overwritten", async () => {
    render(<TasteInboxPage />);
    await settle("p1");
    server.raceLabeller = "Colleague";
    await press("a");
    await settle("p2");
    const p1 = server.rows.find((r) => r.id === "p1")!;
    expect(p1.label).toBe("b");
    expect(p1.labeller_name).toBe("Colleague");
    const { toast } = await import("sonner");
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringMatching(/answered that pair first/)
    );
  });

  it("a viewer who may not label sees the pair and no controls, and keys do nothing", async () => {
    server.canLabel = false;
    render(<TasteInboxPage />);
    await settle("p1");
    expect(screen.getByTestId("taste-view-only")).toBeTruthy();
    expect(screen.queryByTestId("taste-choose-a")).toBeNull();
    await press("a");
    await press("s");
    expect(api.labelTastePair).not.toHaveBeenCalled();
    expect(api.skipTastePair).not.toHaveBeenCalled();
  });

  it("a spent budget hides the head, says nothing blocks, and can be overridden", async () => {
    server.weeklyBudget = 1;
    server.labelledThisWeek = 1;
    render(<TasteInboxPage />);
    await waitFor(() =>
      expect(screen.getByTestId("taste-budget-spent")).toBeTruthy()
    );
    expect(headId()).toBeNull();
    expect(screen.getByTestId("taste-budget-spent").textContent).toMatch(
      /4 more pairs wait; nothing blocks on them/
    );
    fireEvent.click(screen.getByTestId("taste-keep-going"));
    await settle("p1");
    expect(server.inboxCalls.at(-1)).toEqual({ limit: 5, overBudget: true });
  });

  it("an empty queue says where pairs will come from", async () => {
    seed(0);
    render(<TasteInboxPage />);
    await waitFor(() =>
      expect(screen.getByTestId("taste-queue-empty")).toBeTruthy()
    );
    expect(screen.getByTestId("taste-queue-empty").textContent).toMatch(
      /Phase 20/
    );
  });
});
