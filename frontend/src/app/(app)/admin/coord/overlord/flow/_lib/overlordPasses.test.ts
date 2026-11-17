import { describe, expect, it } from "vitest";
import { PASS_DETAIL, PASS_LIST, VERSION_OLD } from "../__fixtures__/flow";
import {
  PASS_LIST_LIMIT,
  accountWords,
  actionWords,
  passReason,
  passRowHref,
  passesQuery,
  readPassDetail,
  readPassList,
  reasonsWords,
  rowCountMismatch,
  type PassDetail,
  type PassList,
} from "./overlordPasses";

describe("passesQuery", () => {
  it("starts at the window's beginning and asks for coord's maximum", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    const qs = new URLSearchParams(passesQuery("24h", now));
    expect(qs.get("since")).toBe("2026-11-01T12:00:00.000Z");
    expect(qs.get("limit")).toBe(String(PASS_LIST_LIMIT));
  });
});

describe("readPassList", () => {
  it("narrows every pass, keeping coord's order", () => {
    const list = readPassList(PASS_LIST) as PassList;
    expect(list.passes.map((p) => p.passId)).toEqual(["p-new", "p-old"]);
    expect(list.total).toBe(2);
    expect(list.truncated).toBe(false);
    expect(list.passes[0]).toMatchObject({
      scope: "full",
      exitCode: 1,
      triageVersion: VERSION_OLD,
      skippedSteps: [],
    });
    expect(list.passes[1]).toMatchObject({
      exitCode: null,
      triageVersion: null,
      skippedSteps: ["layout"],
    });
  });

  it("refuses anything that is not a list answer", () => {
    expect(readPassList(null)).toBeNull();
    expect(readPassList({ ok: false, passes: [] })).toBeNull();
    expect(readPassList({ ok: true })).toBeNull();
  });

  it("makes the whole list unknown when any pass cannot be read", () => {
    expect(
      readPassList({
        ...PASS_LIST,
        passes: [PASS_LIST.passes[0], { pass_id: "p" }],
      })
    ).toBeNull();
  });

  it("keeps an absent truncation flag and exit code unknown", () => {
    const { truncated: _t, ...rest } = PASS_LIST;
    const { exit_code: _e, ...pass } = PASS_LIST.passes[0];
    const list = readPassList({ ...rest, passes: [pass] }) as PassList;
    expect(list.truncated).toBeUndefined();
    expect(list.passes[0].exitCode).toBeUndefined();
    expect(passReason(list.passes[0])).toContain("exit unknown");
  });

  it.each([
    ["started_at", { started_at: "garbage" }],
    ["ended_at", { ended_at: "garbage" }],
  ])("makes the list unknown over an unreadable %s", (_name, bad) => {
    expect(
      readPassList({
        ...PASS_LIST,
        passes: [{ ...PASS_LIST.passes[0], ...bad }],
      })
    ).toBeNull();
  });

  it("keeps a recorded absence apart from a field that did not arrive", () => {
    const {
      ended_at: _e,
      runner_build: _b,
      overlord_versions: _v,
      ...pass
    } = PASS_LIST.passes[0];
    const absent = (readPassList({ ...PASS_LIST, passes: [pass] }) as PassList)
      .passes[0];
    expect(absent.endedAt).toBeUndefined();
    expect(absent.runnerBuild).toBeUndefined();
    expect(absent.triageVersion).toBeUndefined();
    const recorded = (readPassList(PASS_LIST) as PassList).passes[1];
    expect(recorded.endedAt).toBeNull();
    expect(recorded.runnerBuild).toBeNull();
    expect(recorded.triageVersion).toBeNull();
  });

  it("does not read an unknown scope or mode as a default", () => {
    const list = readPassList({
      ...PASS_LIST,
      passes: [{ ...PASS_LIST.passes[0], scope: "partial", mode: "dry" }],
    }) as PassList;
    expect(list.passes[0].scope).toBeNull();
    expect(list.passes[0].mode).toBeNull();
  });
});

describe("readPassDetail", () => {
  const detail = () => readPassDetail(PASS_DETAIL) as PassDetail;

  it("leads with the rows the pass could not read", () => {
    expect(detail().rows.map((r) => r.verdict)).toEqual([
      "UNKNOWN",
      "BUSY",
      "STOPPED",
    ]);
  });

  it("prefers reason codes, and falls back to the screen's prose", () => {
    const rows = detail().rows;
    expect(rows[0].reasons).toEqual(["unknown.pid_absent"]);
    expect(rows[1].reasons).toEqual(["input prompt not found on screen"]);
  });

  it("keeps no reasons recorded apart from reasons it cannot read", () => {
    const row = PASS_DETAIL.pass.rows[0];
    const read = (over: object) =>
      (
        readPassDetail({
          ok: true,
          pass: { ...PASS_DETAIL.pass, rows: [{ ...row, ...over }] },
        }) as PassDetail
      ).rows[0];
    expect(reasonsWords(read({ detail: {} }))).toBe("none recorded");
    expect(reasonsWords(read({ detail: { reasons: "x" } }))).toBe(
      "unknown — could not be read"
    );
    expect(reasonsWords(read({ detail: { reasons: [1] } }))).toBe(
      "unknown — could not be read"
    );
    expect(reasonsWords(read({ detail: "x" }))).toBe(
      "unknown — could not be read"
    );
    // A reason code wins, whatever the free-form detail holds.
    expect(
      reasonsWords(read({ reason_codes: ["a.b"], detail: { reasons: 1 } }))
    ).toBe("a.b");
  });

  it("words a null account as recorded, and a missing one as unknown", () => {
    const row = PASS_DETAIL.pass.rows[0];
    const account = (over: object) =>
      accountWords(
        (
          readPassDetail({
            ok: true,
            pass: { ...PASS_DETAIL.pass, rows: [{ ...row, ...over }] },
          }) as PassDetail
        ).rows[0]
      );
    expect(account({ account: "jan" })).toBe("jan");
    expect(account({ account: null })).toBe("not recorded");
    expect(account({ account: undefined })).toBe("–");
  });

  it("makes the whole pass unknown when any row cannot be read", () => {
    expect(
      readPassDetail({
        ok: true,
        pass: { ...PASS_DETAIL.pass, rows: [{ terminal_id: "t" }] },
      })
    ).toBeNull();
  });

  it("treats a pass with no rows list as unreadable, not as no rows", () => {
    expect(readPassDetail({ ok: true, pass: PASS_LIST.passes[0] })).toBeNull();
  });

  it("says when coord served other than the rows the pass recorded", () => {
    expect(rowCountMismatch(detail())).toBeNull();
    const short = readPassDetail({
      ok: true,
      pass: { ...PASS_DETAIL.pass, rows: PASS_DETAIL.pass.rows.slice(0, 2) },
    }) as PassDetail;
    expect(rowCountMismatch(short)).toBe(
      "This pass recorded 3 rows but coord served 2, so this table is not the whole pass."
    );
  });
});

describe("row words", () => {
  const rows = () => (readPassDetail(PASS_DETAIL) as PassDetail).rows;

  it("words an action with its outcome, and no action as nothing", () => {
    const [unknown, , stopped] = rows();
    expect(actionWords(unknown)).toBe("no action");
    expect(actionWords(stopped)).toBe("nudge (sent_unconfirmed)");
    expect(actionWords({ ...stopped, actionOutcome: null })).toBe("nudge");
  });

  it("links only a row with a proven session id", () => {
    const [unknown, busy] = rows();
    expect(passRowHref(unknown)).toBeNull();
    expect(passRowHref(busy)).toMatch(/^\/sessions\//);
  });

  it("words the pass's exit code and its largest verdicts", () => {
    const list = readPassList(PASS_LIST) as PassList;
    expect(passReason(list.passes[0])).toBe(
      "exit 1 · BUSY 1, STOPPED 1, UNKNOWN 1"
    );
    expect(passReason(list.passes[1])).toBe("no exit code · no rows");
  });

  it("always names UNKNOWN, and says what else it left out", () => {
    const list = readPassList({
      ...PASS_LIST,
      passes: [
        {
          ...PASS_LIST.passes[0],
          row_count: 150,
          verdict_histogram: {
            BUSY: 61,
            STOPPED: 49,
            FINISHED: 21,
            HELD: 5,
            UNKNOWN: 2,
          },
        },
      ],
    }) as PassList;
    expect(passReason(list.passes[0])).toBe(
      "exit 1 · BUSY 61, STOPPED 49, FINISHED 21, UNKNOWN 2, +1 more"
    );
  });

  it("never says no rows of a pass that has rows", () => {
    const list = readPassList({
      ...PASS_LIST,
      passes: [{ ...PASS_LIST.passes[0], verdict_histogram: {} }],
    }) as PassList;
    expect(passReason(list.passes[0])).toBe(
      "exit 1 · no verdict counts recorded"
    );
  });
});
