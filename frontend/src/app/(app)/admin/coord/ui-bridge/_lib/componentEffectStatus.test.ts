/**
 * The component-action effect rules — above all, that an action with no
 * declared effect is UNDECLARED and counted as such, never as a read (served
 * policy `testing` `an-actions-safety-class-is-declared-not-re-derived`).
 *
 * Expected values are literals, spelled out here, so a change to the module's
 * classification reddens these rather than moving with it.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  COMPONENTS_BODY,
  componentsBodyWithDisclosure,
} from "../__fixtures__/runnerBodies";
import {
  actionSplitText,
  componentEffectKind,
  componentStatusWord,
  countEffects,
  EFFECT_ATTENTION_BY_KIND,
  EFFECT_BADGE_CLASS,
  EFFECT_PALETTE,
  effectKindOf,
  readComponents,
  readWrapperDisclosure,
  wrapperDisclosureText,
  type ComponentRecord,
} from "./componentEffectStatus";

const reading = () => {
  const r = readComponents(COMPONENTS_BODY.data);
  if (r === null) throw new Error("fixture did not read");
  return r;
};

describe("effectKindOf", () => {
  it("reads exactly the three declared classes", () => {
    expect(effectKindOf("read")).toBe("read");
    expect(effectKindOf("write")).toBe("write");
    expect(effectKindOf("destructive")).toBe("destructive");
  });

  it("reads an absent effect as UNDECLARED, never as read", () => {
    expect(effectKindOf(undefined)).toBe("undeclared");
    expect(effectKindOf(null)).toBe("undeclared");
  });

  it("reads any other value as UNDECLARED — a malformed declaration is not one", () => {
    for (const v of ["mutate", "READ", "", " read", 1, true, {}]) {
      expect(effectKindOf(v), String(v)).toBe("undeclared");
    }
  });
});

describe("readComponents", () => {
  it("reads every component and every action", () => {
    const r = reading();
    expect(r.unreadable).toBe(0);
    expect(r.components.map((c) => c.id)).toEqual([
      "terminal-tabs",
      "profiles",
      "page-nav",
    ]);
    expect(r.components[0].actions.map((a) => a.effect)).toEqual([
      "read",
      "write",
      "undeclared",
    ]);
  });

  it("counts the undeclared actions — the absent and the malformed alike", () => {
    expect(countEffects(reading().components)).toEqual({
      read: 2,
      write: 1,
      destructive: 1,
      undeclared: 3,
      actions: 7,
      components: 3,
    });
  });

  it("keeps a malformed declaration visible, apart from a missing one", () => {
    const profiles = reading().components[1];
    const byId = new Map(profiles.actions.map((a) => [a.id, a]));
    expect(byId.get("rename-profile")?.unrecognisedEffect).toBe("mutate");
    expect(byId.get("load-profile")?.unrecognisedEffect).toBeUndefined();
    expect(byId.get("load-profile")?.effect).toBe("undeclared");
  });

  it("does not fall back to a standard-verb map: an unannotated `click` is undeclared", () => {
    const r = readComponents({
      components: [{ id: "c", name: "C", actions: [{ id: "click" }] }],
    });
    expect(r?.components[0].actions[0].effect).toBe("undeclared");
  });

  it("is UNKNOWN (null) when the payload carries no components array", () => {
    expect(readComponents(undefined)).toBeNull();
    expect(readComponents({})).toBeNull();
    expect(readComponents({ components: "x" })).toBeNull();
    expect(readComponents([])).toBeNull();
  });

  it("reads an empty array as an answer of no components", () => {
    expect(readComponents({ components: [] })).toMatchObject({
      components: [],
      unreadable: 0,
    });
  });

  it("counts an entry that is not a component instead of dropping it silently", () => {
    const r = readComponents({ components: ["junk", null, { id: "a" }] });
    expect(r?.unreadable).toBe(2);
    expect(r?.components).toHaveLength(1);
    expect(r?.components[0].actions).toEqual([]);
  });

  it("keeps two entries sharing an id apart", () => {
    const r = readComponents({ components: [{ id: "x" }, { id: "x" }] });
    expect(new Set(r?.components.map((c) => c.key)).size).toBe(2);
  });
});

describe("the wrapper-app disclosure (data.wrapperComponents)", () => {
  it("reads the runner's two words as answers", () => {
    expect(
      readWrapperDisclosure({ components: [], wrapperComponents: "withheld" })
    ).toEqual({ kind: "withheld" });
    expect(
      readWrapperDisclosure({ components: [], wrapperComponents: "included" })
    ).toEqual({ kind: "included" });
  });

  it("reads a relayed read as it arrives: the fixture says withheld", () => {
    expect(reading().wrappers).toEqual({ kind: "withheld" });
  });

  it("is UNKNOWN when the reply sends no disclosure (an older build) — never withheld, never included", () => {
    const r = readComponents(componentsBodyWithDisclosure(undefined).data);
    expect(r?.wrappers.kind).toBe("unknown");
    expect(r?.wrappers).toEqual({
      kind: "unknown",
      reason:
        "this runner's reply does not say (an older runner build does not)",
    });
    // The components are still read: only the claim about whose they are is
    // missing, and that is not a reason to hide what was read.
    expect(r?.components).toHaveLength(3);
  });

  it("is UNKNOWN for any other value — a malformed disclosure is not an answer", () => {
    for (const said of [
      "Withheld",
      "INCLUDED",
      " withheld",
      "none",
      "",
      true,
      false,
      0,
      1,
      null,
      {},
      [],
      ["withheld"],
    ]) {
      const d = readWrapperDisclosure({
        components: [],
        wrapperComponents: said,
      });
      expect(d, JSON.stringify(said)).toEqual({
        kind: "unknown",
        reason: "this runner's reply gave an answer this page does not know",
      });
    }
  });

  it("has no disclosure to read in a payload that is not an object", () => {
    for (const payload of [undefined, null, "withheld", 3, ["withheld"]]) {
      expect(readWrapperDisclosure(payload).kind, String(payload)).toBe(
        "unknown"
      );
    }
  });

  it("never quotes a value it did not understand", () => {
    const d = readWrapperDisclosure({ wrapperComponents: "Partner A" });
    expect(wrapperDisclosureText(d)).not.toContain("Partner A");
  });

  it("words each answer so that none can be read as another", () => {
    expect(wrapperDisclosureText({ kind: "withheld" })).toBe(
      "Wrapper apps — applications connected to the runner from outside it — are not consulted over the relay, so this is the runner's own registry only."
    );
    expect(wrapperDisclosureText({ kind: "included" })).toBe(
      "Wrapper apps were consulted: this list merges the runner's own registry with every connected wrapper app's, and it does not say which entry came from which."
    );
    expect(
      wrapperDisclosureText(readWrapperDisclosure({ components: [] }))
    ).toBe(
      "Whether wrapper apps were consulted is unknown: this runner's reply does not say (an older runner build does not)."
    );
  });
});

describe("a component's own summary", () => {
  it("shows its most consequential action, undeclared first", () => {
    const [tabs, profiles, nav] = reading().components;
    expect(componentEffectKind(tabs)).toBe("undeclared");
    expect(componentEffectKind(profiles)).toBe("undeclared");
    expect(componentEffectKind(nav)).toBe("read");
    const destructiveOnly: ComponentRecord = {
      ...nav,
      actions: [{ ...nav.actions[0], effect: "destructive" }],
    };
    expect(componentEffectKind(destructiveOnly)).toBe("destructive");
    expect(componentEffectKind({ ...nav, actions: [] })).toBeNull();
  });

  it("splits its actions in words", () => {
    const [tabs, , nav] = reading().components;
    expect(actionSplitText(tabs)).toBe(
      "3 actions: 1 read, 1 write, 1 undeclared"
    );
    expect(actionSplitText(nav)).toBe("1 action: 1 read");
    expect(actionSplitText({ ...nav, actions: [] })).toBe("no actions");
  });

  it("describes itself from a fixed vocabulary for a withheld name", () => {
    const [tabs, , nav] = reading().components;
    expect(componentStatusWord(tabs)).toBe("has undeclared actions");
    expect(componentStatusWord(nav)).toBe("reads only");
    expect(componentStatusWord({ ...nav, actions: [] })).toBe("no actions");
  });
});

describe("the effect palette (R3)", () => {
  it("agrees with its attention table", () => {
    expect(
      paletteDisagreements(EFFECT_ATTENTION_BY_KIND, EFFECT_PALETTE)
    ).toEqual([]);
  });

  it("paints only UNDECLARED amber — a declared write or delete is a fact, not a fault", () => {
    expect(EFFECT_ATTENTION_BY_KIND).toEqual({
      read: "none",
      write: "none",
      destructive: "none",
      undeclared: "waiting",
    });
    expect(EFFECT_BADGE_CLASS.undeclared).toMatch(/\bbg-amber-/);
    for (const kind of ["read", "write", "destructive"] as const) {
      expect(EFFECT_BADGE_CLASS[kind]).not.toMatch(/\bbg-(red|amber)-/);
    }
  });
});
