/**
 * The UI Bridge dashboard's captions are claims about the product, checked
 * against the code like any other claim (style guide §6.5). These pin the
 * claims a review found false, so a rewrite cannot quietly bring one back:
 *
 * - the trust panel does not say registrations reach a runner through the
 *   cloud relay (the binding guards the UI Bridge's own registrant routes,
 *   which no relay entry carries), nor that every registration is checked —
 *   the binding may be enforcing, only counting, or off;
 * - the app registry panel does not say one registry spans every machine (a
 *   runner on its own database keeps its own list), and says that neither
 *   list is read while presenting;
 * - the screens panel does not say how the model was made (a spec can be
 *   hand-authored, generated or migrated, and the page shows none of that).
 */

import { describe, expect, it } from "vitest";
import { captionSegments, type CaptionText } from "./captionTypes";
import { UI_BRIDGE_CAPTIONS } from "./uiBridgeCaptions";

function plain(text: CaptionText): string {
  return captionSegments(text)
    .map((s) => (typeof s === "string" ? s : (s.text ?? s.term)))
    .join("");
}

const sentences = (key: keyof typeof UI_BRIDGE_CAPTIONS) => {
  const entry = UI_BRIDGE_CAPTIONS[key];
  return `${plain(entry.oneLiner)} ${plain(entry.whyItMatters)}`;
};

describe("the UI Bridge captions say only what the code does", () => {
  it("does not route registrations through the cloud relay, and names the binding's three modes", () => {
    const text = sentences("ui-bridge.sdk-posture");
    expect(text).not.toMatch(/cloud relay/i);
    expect(text).not.toMatch(/every registration/i);
    expect(text).toMatch(/refusing when it enforces/);
    expect(text).toMatch(/only counting when it shadows/);
    expect(text).toMatch(/nothing when it is off/);
  });

  it("does not claim one registry across every machine, and says neither list is read while presenting", () => {
    const text = sentences("ui-bridge.apps");
    expect(text).not.toMatch(/spans every machine/i);
    expect(text).not.toMatch(/one registry/i);
    expect(text).toMatch(/the two can differ/);
    expect(text).toMatch(/neither is read while presenting/);
  });

  it("does not say how the screens' model was produced", () => {
    const text = sentences("ui-bridge.spec-graph");
    expect(text).not.toMatch(/extracted from/i);
    expect(text).not.toMatch(/drawn by hand/i);
    expect(text).not.toMatch(/changes when the code changes/i);
  });
});
