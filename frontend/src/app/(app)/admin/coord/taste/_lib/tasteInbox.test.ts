import { describe, expect, it } from "vitest";
import type { TasteInbox, TastePair, TasteReason } from "@/lib/api/taste";
import {
  bareNote,
  deriveTasteHealth,
  newestOwnLabel,
  pairContext,
  reasonKey,
  resolveKey,
  summarizeReferenceUploads,
} from "./tasteInbox";

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

const image = (sha: string) => ({
  sha256: sha,
  kind: "candidate" as const,
  mime_type: "image/png",
  width: 64,
  height: 48,
  byte_size: 10,
  direction: null,
});

function pairFixture(over: Partial<TastePair> = {}): TastePair {
  return {
    id: "p1",
    repo: null,
    slot_id: null,
    source: "calibration",
    uncertainty: null,
    context: {},
    asset_a: image("a".repeat(64)),
    asset_b: image("b".repeat(64)),
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
    undo: null,
    created_at: "2026-10-15T10:00:00Z",
    updated_at: "2026-10-15T10:00:00Z",
    ...over,
  };
}

function inboxFixture(over: Partial<TasteInbox> = {}): TasteInbox {
  return {
    budget: {
      weekly_budget: 30,
      source: "default",
      week_starts_at: "2026-10-12T00:00:00Z",
      labelled_this_week: 0,
      remaining: 30,
    },
    pending_total: 0,
    labelled_total: 0,
    viewer_user_id: null,
    over_budget: false,
    pairs: [],
    recent: [],
    pool: { images: 0, directions: [] },
    can_label: true,
    reason_vocabulary: VOCAB,
    ...over,
  };
}

describe("resolveKey", () => {
  const press = (
    key: string,
    extra: Partial<Parameters<typeof resolveKey>[0]> = {}
  ) => resolveKey({ key, inTextField: false, ...extra }, VOCAB);

  it("maps the four answers and their arrow twins", () => {
    expect(press("a")).toEqual({ kind: "choose", choice: "a" });
    expect(press("ArrowLeft")).toEqual({ kind: "choose", choice: "a" });
    expect(press("b")).toEqual({ kind: "choose", choice: "b" });
    expect(press("ArrowRight")).toEqual({ kind: "choose", choice: "b" });
    expect(press("x")).toEqual({ kind: "choose", choice: "both_bad" });
    expect(press("s")).toEqual({ kind: "skip" });
    expect(press("u")).toEqual({ kind: "undo" });
    expect(press("c")).toEqual({ kind: "focusComment" });
    expect(press("e")).toEqual({ kind: "focusEdit" });
  });

  it("gives every reason a number key, 1-9 then 0, in vocabulary order", () => {
    const keys = VOCAB.map((_, i) => reasonKey(i));
    expect(keys).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
    VOCAB.forEach((reason, i) =>
      expect(press(keys[i] as string)).toEqual({ kind: "toggleReason", reason })
    );
    expect(reasonKey(10)).toBeNull();
  });

  it("never labels from inside a text field — only Escape acts there", () => {
    for (const key of ["a", "b", "x", "s", "u", "1", "ArrowLeft"]) {
      expect(press(key, { inTextField: true })).toBeNull();
    }
    expect(press("Escape", { inTextField: true })).toEqual({
      kind: "leaveField",
    });
  });

  it("leaves ArrowDown to the browser: it scrolls, it never skips", () => {
    expect(press("ArrowDown")).toBeNull();
    expect(press("ArrowUp")).toBeNull();
  });

  it("leaves modified keys to the browser", () => {
    expect(press("a", { ctrlKey: true })).toBeNull();
    expect(press("b", { metaKey: true })).toBeNull();
    expect(press("x", { altKey: true })).toBeNull();
    expect(press("q")).toBeNull();
  });
});

describe("newestOwnLabel", () => {
  const mine = pairFixture({ id: "mine", label: "a", labeller_user_id: "me" });
  const theirs = pairFixture({
    id: "theirs",
    label: "b",
    labeller_user_id: "colleague",
  });

  it("skips a colleague's newer label and finds the viewer's own", () => {
    expect(newestOwnLabel([theirs, mine], "me")?.id).toBe("mine");
  });

  it("finds nothing when the viewer has no label in the list", () => {
    expect(newestOwnLabel([theirs], "me")).toBeNull();
  });

  it("finds nothing when the read named no viewer", () => {
    expect(newestOwnLabel([theirs, mine], null)).toBeNull();
    expect(
      newestOwnLabel([pairFixture({ labeller_user_id: null })], null)
    ).toBeNull();
  });
});

describe("summarizeReferenceUploads", () => {
  it("says the pool grew only by the uploads that joined it", () => {
    const summary = summarizeReferenceUploads([
      { kind: "exemplar" },
      { kind: "candidate" },
      { kind: "capture" },
    ]);
    expect(summary?.inPool).toBe(2);
    expect(summary?.tone).toBe("warning");
    expect(summary?.message).toBe(
      "2 images are in the calibration pool. 1 image was already stored as a capture, so it stays out of the pool."
    );
  });

  it("is a plain success when every upload joined", () => {
    const summary = summarizeReferenceUploads([{ kind: "exemplar" }]);
    expect(summary).toMatchObject({ inPool: 1, tone: "success" });
    expect(summary?.message).toBe("1 image is in the calibration pool.");
  });

  it("never claims the pool grew when nothing joined it", () => {
    const summary = summarizeReferenceUploads([
      { kind: "derivative" },
      { kind: "derivative" },
    ]);
    expect(summary?.inPool).toBe(0);
    expect(summary?.message).not.toMatch(/in the calibration pool\./);
    expect(summary?.message).toMatch(
      /2 images were already stored as a derivative/
    );
  });

  it("says nothing for no uploads", () => {
    expect(summarizeReferenceUploads([])).toBeNull();
  });
});

describe("pair wording", () => {
  it("names the slot, or says the pair serves none", () => {
    expect(
      pairContext(pairFixture({ repo: "qontinui-web", slot_id: "home.hero" }))
    ).toBe("qontinui-web · home.hero");
    expect(pairContext(pairFixture())).toMatch(/No slot/);
  });

  it("says a pair without captures is shown bare, and nothing when in situ", () => {
    expect(bareNote(pairFixture())).toMatch(/Shown bare/);
    expect(bareNote(pairFixture({ in_situ: true }))).toBeNull();
  });
});

describe("deriveTasteHealth", () => {
  it("is amber and UNKNOWN when the inbox could not be read", () => {
    const h = deriveTasteHealth(null, "GET failed: 503");
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/could not be read/);
    expect(h.detail).toBe("GET failed: 503");
  });

  it("is green with nothing queued, and points at the calibration batch first", () => {
    const h = deriveTasteHealth(inboxFixture(), null);
    expect(h.level).toBe("green");
    expect(h.detail).toMatch(/calibration batch/);
  });

  it("is amber while pairs wait and budget is left", () => {
    const h = deriveTasteHealth(
      inboxFixture({ pending_total: 3, pairs: [pairFixture()] }),
      null
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "3 pairs are waiting for a label — 30 left in this week's budget."
    );
    expect(h.badges.find((b) => b.key === "queue")?.label).toBe("queue 3");
  });

  it("is green once the week's budget is given: nothing blocks on the rest", () => {
    const inbox = inboxFixture({ pending_total: 2 });
    inbox.budget = { ...inbox.budget, labelled_this_week: 30, remaining: 0 };
    const h = deriveTasteHealth(inbox, null);
    expect(h.level).toBe("green");
    expect(h.headline).toMatch(/nothing blocks on them/);
    expect(h.badges.find((b) => b.key === "week")?.label).toBe(
      "this week 30/30"
    );
  });

  it("keeps the last inbox and says the latest read failed", () => {
    const h = deriveTasteHealth(inboxFixture({ pending_total: 1 }), "timeout");
    expect(h.headline).toMatch(/latest read failed: timeout/);
  });
});
