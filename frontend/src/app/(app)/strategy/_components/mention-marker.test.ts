import { describe, expect, it } from "vitest";

import {
  MENTION_MARKER_REGEX,
  extractMentionedUserIds,
  parseMentionSegments,
} from "./mention-marker";

const UID_A = "11111111-2222-3333-4444-555555555555";
const UID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("mention-marker regex", () => {
  it("matches a bare marker", () => {
    const m = `@[user_id:${UID_A}]`.match(MENTION_MARKER_REGEX);
    expect(m).not.toBeNull();
  });

  it("matches markers inside surrounding prose", () => {
    const text = `hi @[user_id:${UID_A}] and @[user_id:${UID_B}] please review`;
    const matches = Array.from(text.matchAll(MENTION_MARKER_REGEX));
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe(UID_A);
    expect(matches[1][1]).toBe(UID_B);
  });

  it("does not match malformed markers", () => {
    expect(`@[user_id:not-a-uuid]`.match(MENTION_MARKER_REGEX)).toBeNull();
    expect("@bare-username".match(MENTION_MARKER_REGEX)).toBeNull();
    expect(`@[other:${UID_A}]`.match(MENTION_MARKER_REGEX)).toBeNull();
  });
});

describe("parseMentionSegments", () => {
  it("returns a single text segment for plain prose", () => {
    const out = parseMentionSegments("just words here");
    expect(out).toEqual([{ type: "text", value: "just words here" }]);
  });

  it("splits prose around a marker", () => {
    const out = parseMentionSegments(`hi @[user_id:${UID_A}] there`);
    expect(out).toEqual([
      { type: "text", value: "hi " },
      { type: "mention", userId: UID_A.toLowerCase() },
      { type: "text", value: " there" },
    ]);
  });

  it("handles back-to-back markers", () => {
    const out = parseMentionSegments(`@[user_id:${UID_A}]@[user_id:${UID_B}]`);
    expect(out).toEqual([
      { type: "mention", userId: UID_A.toLowerCase() },
      { type: "mention", userId: UID_B.toLowerCase() },
    ]);
  });
});

describe("extractMentionedUserIds", () => {
  it("returns unique UUIDs in order of first appearance", () => {
    const out = extractMentionedUserIds(
      `@[user_id:${UID_A}] hi @[user_id:${UID_B}] then @[user_id:${UID_A}] again`
    );
    expect(out).toEqual([UID_A.toLowerCase(), UID_B.toLowerCase()]);
  });

  it("returns [] for prose without markers", () => {
    expect(extractMentionedUserIds("nothing here")).toEqual([]);
  });
});
