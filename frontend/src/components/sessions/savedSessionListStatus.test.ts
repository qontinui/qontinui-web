/**
 * savedSessionListStatus — the words the "Saved tab lists" panel shows.
 *
 * Plan `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3. Pins D2 (tab names), D3 (the finished badge, both sources and the
 * one honest `unknown`), D4 (which runner a save reaches), D7 (the predates
 * words), D8 (a withheld title) and the 14-day countdown, without a DOM.
 */

import { describe, expect, it } from "vitest";

import { paletteDisagreements } from "@/components/console/attention";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import {
  CLAUDE_1,
  DAY_MS,
  DEVICE_A,
  DEVICE_B,
  DEVICE_C,
  NOW,
  coordStatus,
  defaultRunners,
  detail,
  iso,
  layoutPages,
  runner,
  session,
  summary,
} from "@/test/savedSessionListsFixture";
import { SESSION_WORK_CLASS } from "./sessionConsoleStatus";
import {
  RUNNER_PREDATES_SAVED_TAB_LISTS,
  SAVED_SESSION_FINISHED_ATTENTION_BY_KIND,
  SAVED_SESSION_FINISHED_CLASS,
  SAVED_SESSION_FINISHED_PALETTE,
  SECONDARY_NOT_ADDRESSABLE,
  deletionCountdown,
  deriveSavedSessionFinished,
  listReason,
  runnerFilterOptions,
  runnerPickerRows,
  saveRefusalLead,
  savedListMarkdown,
  sessionLine,
  tabBlocks,
  tabHeadings,
  unknownFinishedCount,
} from "./savedSessionListStatus";

const confirmed = (over: Parameters<typeof session>[0]) =>
  session({ claudeSessionId: CLAUDE_1, ...over });

describe("D3 — the finished badge", () => {
  it("is the /sessions work axis: same class, same ✓, calm", () => {
    expect(SAVED_SESSION_FINISHED_CLASS.finished).toBe(
      SESSION_WORK_CLASS.finished
    );
    expect(SAVED_SESSION_FINISHED_PALETTE.doneGlyphKinds?.has("finished")).toBe(
      true
    );
    expect(SAVED_SESSION_FINISHED_ATTENTION_BY_KIND.finished).toBe("none");
    // `unknown` sits on R3's ignorance floor: amber, never calm.
    expect(SAVED_SESSION_FINISHED_CLASS.unknown).toBe(UNKNOWN_AMBER);
    expect(SAVED_SESSION_FINISHED_ATTENTION_BY_KIND.unknown).toBe("waiting");
    expect(
      paletteDisagreements(
        SAVED_SESSION_FINISHED_ATTENTION_BY_KIND,
        SAVED_SESSION_FINISHED_PALETTE
      )
    ).toEqual([]);
  });

  it("says finished from the runner's marker alone, naming it", () => {
    const v = deriveSavedSessionFinished(
      confirmed({ terminalId: "t", finished: true, finishReason: "done here" }),
      { [CLAUDE_1]: { read: "failed", value: null } }
    );
    expect(v.status?.kind).toBe("finished");
    expect(v.sources).toEqual(["runner marker"]);
    expect(v.status?.reason).toMatch(/runner's finished marker/);
    expect(v.status?.reason).toMatch(/done here/);
    expect(v.status?.reason).not.toMatch(/coord/);
  });

  it("says finished from coord alone — the legacy `done` word included", () => {
    for (const word of ["finished", "done"]) {
      const v = deriveSavedSessionFinished(
        confirmed({ terminalId: "t", finished: false }),
        { [CLAUDE_1]: { read: "ok", value: word } }
      );
      expect(v.status?.kind, word).toBe("finished");
      expect(v.sources).toEqual(["coord"]);
      expect(v.status?.reason).toMatch(/coord's session status/);
    }
  });

  it("names both sources when both say finished", () => {
    const v = deriveSavedSessionFinished(
      confirmed({ terminalId: "t", finished: true }),
      { [CLAUDE_1]: { read: "ok", value: "finished" } }
    );
    expect(v.sources).toEqual(["runner marker", "coord"]);
    expect(v.status?.reason).toMatch(/runner's finished marker and coord/);
  });

  it("never paints a 'not finished' badge", () => {
    const answers = [
      { read: "ok", value: "working" },
      { read: "ok", value: null },
    ] as const;
    for (const marker of [false, null] as const) {
      for (const answer of answers) {
        const v = deriveSavedSessionFinished(
          confirmed({ terminalId: "t", finished: marker }),
          { [CLAUDE_1]: answer }
        );
        expect(v.status, `${marker} / ${answer.value}`).toBeNull();
      }
    }
    // A marker of `false` beside a coord that could not answer is still a
    // runner answer — nothing to show, and not unknown.
    expect(
      deriveSavedSessionFinished(
        confirmed({ terminalId: "t", finished: false }),
        {
          [CLAUDE_1]: { read: "failed", value: null },
        }
      ).status
    ).toBeNull();
  });

  it("says unknown, with the reason, only when NEITHER source answered", () => {
    const failed = deriveSavedSessionFinished(confirmed({ terminalId: "t" }), {
      [CLAUDE_1]: { read: "failed", value: null },
    });
    expect(failed.status?.kind).toBe("unknown");
    expect(failed.status?.reason).toMatch(/coord could not be read/);

    const notOurs = deriveSavedSessionFinished(confirmed({ terminalId: "t" }), {
      [CLAUDE_1]: { read: "unknown", value: null },
    });
    expect(notOurs.status?.reason).toMatch(/no record of this session/);

    // No entry at all is an absence, never a "no".
    const missing = deriveSavedSessionFinished(
      confirmed({ terminalId: "t" }),
      {}
    );
    expect(missing.status?.kind).toBe("unknown");
    expect(missing.status?.reason).toMatch(/not recorded/);

    // A key the wire left out reads as null, exactly like a sent null.
    const absentKey = deriveSavedSessionFinished(
      {
        terminalId: "t",
        isAlive: true,
        titleWithheld: false,
        claudeSessionId: CLAUDE_1,
      },
      { [CLAUDE_1]: { read: "failed", value: null } }
    );
    expect(absentKey.status?.kind).toBe("unknown");
  });

  it("gives a terminal with no confirmed session nothing at all", () => {
    expect(
      deriveSavedSessionFinished(session({ terminalId: "shell" }), {}).status
    ).toBeNull();
  });

  it("counts the unknowns of a whole list", () => {
    expect(unknownFinishedCount(detail({ id: "l" }))).toBe(1);
  });
});

describe("D2 — tab headings", () => {
  it("keeps the runner's order and names unnamed and duplicate tabs", () => {
    const headings = tabHeadings(layoutPages());
    expect(headings.map((h) => h.text)).toEqual([
      "Build",
      "Review (1b1b1b1b)",
      "Review (2c2c2c2c)",
      "Tab 3d3d3d3d (name not reported)",
    ]);
    // Never an invented "Page N".
    expect(headings.some((h) => /Page \d/.test(h.text))).toBe(false);
    expect(headings[1]?.title).toMatch(
      /2 tabs in this list are named "Review"/
    );
  });

  it("qualifies a label only when another tab shares it", () => {
    const [only] = tabHeadings([
      { pageId: "abcdef0123", label: "Solo", sessions: [] },
    ]);
    expect(only?.text).toBe("Solo");
  });

  it("does not pass an empty label off as a name", () => {
    const [blank] = tabHeadings([
      { pageId: "abcdef0123", label: "  ", sessions: [] },
    ]);
    expect(blank?.text).toBe("Tab abcdef01 (empty name)");
  });
});

describe("tab blocks — empty tabs collapse per run, in the runner's order", () => {
  const [build, review1, review2, unnamed] = layoutPages();
  const empty = (pageId: string, label: string | null) => ({
    pageId,
    label,
    sessions: [],
  });

  it("leaves a snapshot with no empty tab as one block per tab", () => {
    expect(tabBlocks(layoutPages()).map((b) => b.kind)).toEqual([
      "tab",
      "tab",
      "tab",
      "tab",
    ]);
  });

  it("collapses each run of consecutive empty tabs into one block, in place", () => {
    if (!build || !review1 || !review2 || !unnamed) throw new Error("fixture");
    const blocks = tabBlocks([
      empty("e1e1e1e1-0", "Scratch"),
      build,
      empty("e2e2e2e2-0", "Old 1"),
      empty("e3e3e3e3-0", null),
      empty("e4e4e4e4-0", "Old 2"),
      review1,
      review2,
      unnamed,
      empty("e5e5e5e5-0", "Last"),
    ]);
    expect(
      blocks.map((b) =>
        b.kind === "tab" ? `tab:${b.heading.text}` : `empty:${b.text}`
      )
    ).toEqual([
      "empty:Scratch: no terminals.",
      "tab:Build",
      "empty:3 tabs with no terminals: Old 1, Tab e3e3e3e3 (name not reported), Old 2.",
      "tab:Review (1b1b1b1b)",
      "tab:Review (2c2c2c2c)",
      "tab:Tab 3d3d3d3d (name not reported)",
      "empty:Last: no terminals.",
    ]);
    // Every tab is still on the page, counted once.
    const counted = blocks.reduce(
      (n, b) => n + (b.kind === "tab" ? 1 : b.headings.length),
      0
    );
    expect(counted).toBe(9);
  });

  it("makes one block of a snapshot whose every tab is empty", () => {
    const blocks = tabBlocks([
      empty("e1e1e1e1-0", "A"),
      empty("e2e2e2e2-0", "B"),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind === "empty" && blocks[0].text).toBe(
      "2 tabs with no terminals: A, B."
    );
  });

  it("keeps each empty tab's own heading and tooltip inside its run", () => {
    const [block] = tabBlocks([empty("abcdef0123", "  ")]);
    if (block?.kind !== "empty") throw new Error("expected an empty block");
    expect(block.text).toBe("Tab abcdef01 (empty name): no terminals.");
    expect(block.headings[0].title).toBe(
      "The runner reported this tab with an empty name."
    );
  });

  it("exports the same runs to Markdown as the panel shows", () => {
    if (!build) throw new Error("fixture");
    const md = savedListMarkdown(
      detail({
        id: "l",
        layout: {
          ...detail({ id: "l" }).layout,
          pages: [
            build,
            empty("e1e1e1e1-0", "Old 1"),
            empty("e2e2e2e2-0", "Old 2"),
          ],
        },
      }),
      "merytshost"
    );
    expect(md).toContain("\n## 2 tabs with no terminals: Old 1, Old 2.\n");
    expect(md).not.toContain("(no terminals)");
    expect(md).not.toContain("## Old 1");
    expect(md).toContain("## Build");
  });
});

describe("one saved terminal", () => {
  const status = coordStatus();

  it("shows a withheld title in words (D8)", () => {
    const line = sessionLine(
      session({
        terminalId: "t",
        claudeSessionId: CLAUDE_1,
        titleWithheld: true,
      }),
      status
    );
    expect(line.title.text).toBe("title withheld");
    expect(line.title.withheld).toBe(true);
    expect(line.title.tooltip).toMatch(/Terminal streaming/);
  });

  it("names what it does not know instead of leaving it blank (D3)", () => {
    const line = sessionLine(
      session({ terminalId: "t", claudeSessionId: CLAUDE_1, isAlive: false }),
      status
    );
    expect(line.name).toMatchObject({
      text: "name not reported",
      known: false,
    });
    expect(line.account).toMatchObject({
      text: "account unknown",
      known: false,
    });
    expect(line.title).toMatchObject({ text: "–", known: false });
    expect(line.process.text).toBe("exited");
  });

  it("marks a terminal with no confirmed session, by its spawn name", () => {
    const line = sessionLine(
      session({ terminalId: "term-x", spawnName: "shell-1" }),
      status
    );
    expect(line.confirmed).toBe(false);
    expect(line.name.text).toBe("shell-1");
    expect(line.account.text).toBe("–");
    const unnamed = sessionLine(session({ terminalId: "abcdef0123" }), status);
    expect(unnamed.name.text).toBe("Terminal abcdef01");
  });
});

describe("the 14-day countdown", () => {
  const at = (ms: number) => iso(NOW + ms);

  it("reads 14 days for a list saved a moment ago, then counts down", () => {
    expect(deletionCountdown(at(14 * DAY_MS - 5_000), NOW).text).toBe(
      "deletes in 14 days"
    );
    expect(deletionCountdown(at(3 * DAY_MS), NOW).text).toBe(
      "deletes in 3 days"
    );
    expect(deletionCountdown(at(2 * DAY_MS), NOW).text).toBe(
      "deletes in 2 days"
    );
    expect(deletionCountdown(at(47 * 3_600_000 + 1_000), NOW).text).toBe(
      "deletes in 47 hours"
    );
    expect(deletionCountdown(at(3_600_000), NOW).text).toBe(
      "deletes in 1 hour"
    );
    expect(deletionCountdown(at(20 * 60_000), NOW).text).toBe(
      "deletes in 20 minutes"
    );
    expect(deletionCountdown(at(10_000), NOW).text).toBe("deletes in 1 minute");
  });

  it("says expired once the time has passed, and unknown when unreadable", () => {
    expect(deletionCountdown(at(-1), NOW)).toMatchObject({
      text: "expired",
      expired: true,
    });
    expect(deletionCountdown("not a time", NOW).text).toBe(
      "deletion time unknown"
    );
  });

  it("always carries the absolute time for a title", () => {
    expect(deletionCountdown(at(3 * DAY_MS), NOW).title).toMatch(
      /^Deleted automatically /
    );
  });
});

describe("D4 — the runner picker", () => {
  it("offers a relay-connected device by its primary, never a secondary", () => {
    const [a, b] = runnerPickerRows(defaultRunners());
    expect(a).toMatchObject({
      deviceId: DEVICE_A,
      host: "merytshost",
      instanceText: "primary :9876",
      selectable: true,
      disabledReason: null,
    });
    expect(a?.secondaries).toEqual([{ key: "runner:test-1@9877", port: 9877 }]);
    expect(SECONDARY_NOT_ADDRESSABLE).toBe("not addressable over the relay");
    // Not connected: listed, disabled, with the relay's own words.
    expect(b).toMatchObject({
      deviceId: DEVICE_B,
      selectable: false,
      instanceText: null,
    });
    expect(b?.disabledReason).toMatch(/runner not connected/);
    expect(b?.title).toMatch(/Web Integration/);
  });

  it("lists connected devices first, then by name", () => {
    const rows = runnerPickerRows([
      runner({ id: DEVICE_B, hostname: "aardvark", wsConnected: false }),
      runner({ id: DEVICE_C, hostname: "zebra" }),
      runner({ id: DEVICE_A, hostname: "mole" }),
    ]);
    expect(rows.map((r) => r.host)).toEqual(["mole", "zebra", "aardvark"]);
    // A backend that reports no instances still offers the connected device.
    expect(rows[0]?.instanceText).toBe("relay-connected runner");
  });
});

describe("the runner filter", () => {
  it("counts each runner's lists and tells same-named runners apart", () => {
    const lists = [
      summary({ id: "1", device_id: DEVICE_A }),
      summary({ id: "2", device_id: DEVICE_C }),
      summary({ id: "3", device_id: DEVICE_A }),
    ];
    expect(runnerFilterOptions(lists, () => "box")).toEqual([
      { deviceId: DEVICE_A, label: "box (aaaaaaaa)", count: 2 },
      { deviceId: DEVICE_C, label: "box (cccccccc)", count: 1 },
    ]);
    expect(
      runnerFilterOptions(lists, (id) => (id === DEVICE_A ? "a" : "c")).map(
        (o) => o.label
      )
    ).toEqual(["a", "c"]);
  });
});

describe("the list row", () => {
  it("states counts and the saver, and an absent name honestly", () => {
    expect(
      listReason(summary({ id: "1", tab_count: 1, session_count: 3 }))
    ).toBe("1 tab · 3 sessions · saved by Josh");
    expect(listReason(summary({ id: "1", created_by_name: null }))).toMatch(
      /saved by a user with no name on record$/
    );
  });
});

describe("D7 — the predates refusal's words", () => {
  it("leads the predates refusal with the plan's sentence, and nothing else", () => {
    expect(saveRefusalLead("runner_predates_terminal_layout")).toBe(
      RUNNER_PREDATES_SAVED_TAB_LISTS
    );
    expect(RUNNER_PREDATES_SAVED_TAB_LISTS).toMatch(
      /this runner's build predates saved tab lists — rebuild it to enable saving/i
    );
    expect(saveRefusalLead("runner_not_connected")).toBeNull();
    expect(saveRefusalLead(null)).toBeNull();
    // A discriminator that happens to be an Object.prototype key is not a lead.
    expect(saveRefusalLead("constructor")).toBeNull();
  });
});

describe("Copy as Markdown", () => {
  const md = savedListMarkdown(
    detail({ id: "l1", title: "Before *rebuild*" }),
    "merytshost"
  );

  it("heads the list with its runner, save time and deletion time", () => {
    expect(md).toMatch(/^# Saved tab list: Before \\\*rebuild\\\*$/m);
    expect(md).toMatch(
      /^- Runner: merytshost \(instance primary, port 9876\)$/m
    );
    expect(md).toMatch(/^- Saved: .* by Josh$/m);
    expect(md).toMatch(/^- Deleted automatically: /m);
  });

  it("writes the tabs in the runner's order, in the panel's words", () => {
    const headings = [...md.matchAll(/^## (.*)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Build",
      "Review (1b1b1b1b)",
      "Review (2c2c2c2c)",
      "Tab 3d3d3d3d (name not reported)",
    ]);
    expect(md).toContain(
      "- **brave-otter** · account: work · ✓ finished (runner marker) · alive · title: cargo build"
    );
    expect(md).toContain(
      "- **calm-heron** · account: personal · ✓ finished (coord) · exited"
    );
    expect(md).toContain(
      "- **quiet-lynx** · account: work · ✓ finished (runner marker and coord) · alive · title withheld"
    );
    expect(md).toMatch(
      /- name not reported · account: account unknown · finished: unknown \(.*coord could not be read.*\) · alive/
    );
    // No badge, no words: there is no "not finished".
    expect(md).toContain("- **swift-crane** · account: work · alive");
    expect(md).toContain("- shell-1 (no confirmed session) · alive");
    expect(md).not.toMatch(/not finished/);
  });
});
