import { describe, expect, it } from "vitest";
import {
  bodyWithoutLeadHeading,
  positionsAfterMove,
  sortIntentEntries,
  titleOfDocument,
  hasContent,
  stripFrontmatter,
  toIntentEntry,
  type IntentDocument,
} from "./intent";

/** A served `intent-documents` row. Classification is the server's
 *  (`test_overview_authoring.py` pins `_state`), so tests name the state. */
function served(overrides: Partial<IntentDocument>): IntentDocument {
  return {
    id: "product_intent:vision",
    kind: "product_intent",
    name: "vision",
    description: null,
    body: "",
    frontmatter: null,
    overview_order: null,
    state: "authored",
    error: null,
    status: null,
    withdrawn: false,
    version: 2,
    updated_at: "2026-09-20T10:00:00Z",
    updated_by: null,
    ...overrides,
  };
}

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block", () => {
    expect(
      stripFrontmatter("---\nstatus: accepted\n---\n\n# Title\nBody")
    ).toBe("# Title\nBody");
  });

  it("leaves a body without frontmatter alone, including a later rule", () => {
    const body = "# Title\n\nText\n\n---\n\nMore";
    expect(stripFrontmatter(body)).toBe(body);
  });
});

describe("toIntentEntry", () => {
  it("never passes a skeleton's template text through", () => {
    const entry = toIntentEntry(
      served({
        state: "skeleton",
        body: "# Product intent\n\n_Describe the product here._",
      })
    );
    expect(entry.state).toBe("skeleton");
    expect(entry.body).toBe("");
    // …nor offers it to an editor as a starting point.
    expect(entry.source).toBe("");
  });

  it("keeps an authored body, and the prose an editor starts from", () => {
    const entry = toIntentEntry(
      served({ body: "# Vision\n\nA portal for partners.", version: 7 })
    );
    expect(entry.state).toBe("authored");
    expect(entry.body).toBe("A portal for partners.");
    expect(entry.source).toBe("# Vision\n\nA portal for partners.");
    expect(entry.version).toBe(7);
    expect(entry.id).toBe("product_intent:vision");
  });

  it("reads the served position", () => {
    expect(toIntentEntry(served({ overview_order: 2 })).order).toBe(2);
  });
});

describe("hasContent", () => {
  it("treats an authored document with an empty body as not written", () => {
    const entry = toIntentEntry(served({ body: "   \n" }));
    expect(entry.state).toBe("authored");
    expect(hasContent(entry)).toBe(false);
  });

  it("never lets a skeleton read as written", () => {
    expect(hasContent(toIntentEntry(served({ state: "skeleton" })))).toBe(
      false
    );
  });

  it("reports an unreadable document instead of calling it unwritten", () => {
    const entry = toIntentEntry(
      served({ state: "unreadable", error: "GET /x failed: 502 - {}" })
    );
    expect(hasContent(entry)).toBe(true);
    expect(entry.error).toContain("502");
  });
});

describe("titleOfDocument", () => {
  it("takes the document's own opening heading, not its description", () => {
    expect(
      titleOfDocument(
        "vision",
        "---\nsubject: Qontinui\n---\n\n# Vision — the autonomy ratchet\n\nBody."
      )
    ).toBe("Vision — the autonomy ratchet");
  });

  it("reads a slug as words when the body opens with none", () => {
    expect(titleOfDocument("non-goals", "Just prose, no heading.")).toBe(
      "Non goals"
    );
    expect(titleOfDocument("current-initiative", "")).toBe(
      "Current initiative"
    );
  });

  it("ignores a heading that is not the document's first line", () => {
    // Taking a later heading would disagree with the body strip, and the
    // title would then render twice.
    expect(
      titleOfDocument("x", "Opening prose.\n\n## A section\n\nMore.")
    ).toBe("X");
  });
});

describe("bodyWithoutLeadHeading", () => {
  it("removes the heading the page now renders itself", () => {
    const body = "---\na: b\n---\n\n# Vision\n\n## What it is for\n\nText.";
    expect(bodyWithoutLeadHeading(body)).toBe("## What it is for\n\nText.");
  });

  it("leaves a body that opens with prose alone", () => {
    expect(bodyWithoutLeadHeading("Prose first.\n\n# Later heading")).toBe(
      "Prose first.\n\n# Later heading"
    );
  });
});

describe("sortIntentEntries", () => {
  const entry = (
    kind: string,
    name: string,
    title: string,
    order: number | null = null
  ) =>
    ({
      kind,
      name,
      title,
      order,
      hasBody: true,
      state: "authored",
      body: "x",
      updatedAt: null,
    }) as never;

  it("puts the vision first, which coord's alphabetical order did not", () => {
    // The live corpus: coord lists non-goals, open-questions, vision.
    const sorted = sortIntentEntries([
      entry("product_intent", "non-goals", "Non-goals"),
      entry("product_intent", "open-questions", "Open questions"),
      entry("product_intent", "vision", "Vision — the autonomy ratchet"),
    ]);
    expect(sorted.map((e) => e.name)).toEqual([
      "vision",
      "non-goals",
      "open-questions",
    ]);
  });

  it("lets an operator-set order outrank the seeded names", () => {
    // `vision` leads by default; an explicit order on another document wins,
    // which is what survives a rename of the seeded rows.
    const sorted = sortIntentEntries([
      entry("product_intent", "vision", "Vision"),
      entry("product_intent", "charter", "Charter", 1),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["charter", "vision"]);
  });

  it("sorts unlisted documents after listed ones, by title", () => {
    const sorted = sortIntentEntries([
      entry("audience_profile", "z-team", "The operating team"),
      entry("audience_profile", "a-agent", "The AI development agent"),
    ]);
    expect(sorted.map((e) => e.title)).toEqual([
      "The AI development agent",
      "The operating team",
    ]);
  });
});

describe("the title and the body agree on one heading", () => {
  const doc = (body: string) => served({ body });

  it("ignores a # comment inside a fenced code block", () => {
    const body =
      "We ship weekly.\n\n```bash\n# Rebuild the index\nnpm run x\n```\n";
    const entry = toIntentEntry(doc(body));
    expect(entry.title).toBe("Vision");
    expect(entry.body).toContain("# Rebuild the index");
  });

  it("never renders the title twice", () => {
    const body = "Opening prose.\n\n## A section\n\nMore.";
    const entry = toIntentEntry(doc(body));
    // The document does not OPEN with a heading, so the slug titles it and
    // the body keeps every heading it had.
    expect(entry.title).toBe("Vision");
    expect(entry.body).toBe(body);
  });

  it("handles a setext heading", () => {
    const entry = toIntentEntry(
      doc("Vision — the ratchet\n====\n\nBody text.")
    );
    expect(entry.title).toBe("Vision — the ratchet");
    expect(entry.body).toBe("Body text.");
  });

  it("keeps a hash that is part of a word", () => {
    expect(titleOfDocument("x", "# Why C# beats F#\n\nBody.")).toBe(
      "Why C# beats F#"
    );
  });

  it("reads a title written with inline markdown as words", () => {
    expect(titleOfDocument("x", "# *[Vision](/v)* of the fleet\n")).toBe(
      "Vision of the fleet"
    );
  });

  it("reads a slug's hyphens as word breaks in the fallback", () => {
    expect(titleOfDocument("current-initiative", "Prose, no heading.")).toBe(
      "Current initiative"
    );
  });

  it("a document that is only a title still has content", () => {
    const entry = toIntentEntry(doc("---\na: b\n---\n\n# Q4 — onboarding\n"));
    expect(entry.title).toBe("Q4 — onboarding");
    expect(entry.body).toBe("");
    expect(hasContent(entry)).toBe(true);
  });

  it("an authored document with no prose at all is still unwritten", () => {
    expect(hasContent(toIntentEntry(doc("---\na: b\n---\n\n   \n")))).toBe(
      false
    );
  });
});

describe("a document that does not open with a heading keeps its first line", () => {
  const doc = (body: string) => served({ body });

  // A `---` under a quote, a list item or an HTML block is a thematic break,
  // not a heading underline. Reading one as a heading DELETED that line.
  it.each([
    ["> Draft note, reviewed 2026-09-01\n---\n\n## Vision\n\nBody.", "> Draft"],
    ["1. First\n---\n\nBody.", "1. First"],
    ["<!-- internal -->\n---\n\n# Vision\n", "<!-- internal -->"],
  ])("leaves %j alone", (body, opener) => {
    const entry = toIntentEntry(doc(body));
    expect(entry.title).toBe("Vision");
    expect(entry.body.startsWith(opener)).toBe(true);
  });

  it("still reads a setext heading underlined with =", () => {
    const entry = toIntentEntry(doc("Vision — the ratchet\n====\n\nBody."));
    expect(entry.title).toBe("Vision — the ratchet");
    expect(entry.body).toBe("Body.");
  });

  it("keeps a heading made only of markers in the body", () => {
    const entry = toIntentEntry(doc("# ***\n\nBody."));
    expect(entry.title).toBe("Vision");
    expect(entry.body).toBe("# ***\n\nBody.");
  });
});

describe("titles that name coord fields", () => {
  it("keeps snake_case identifiers intact", () => {
    expect(titleOfDocument("m", "# new_work_bar adherence\n")).toBe(
      "new_work_bar adherence"
    );
    expect(titleOfDocument("m", "# The in_scope / out_of_scope split\n")).toBe(
      "The in_scope / out_of_scope split"
    );
  });

  it("still unwraps emphasis and code markers around words", () => {
    expect(titleOfDocument("m", "# *Vision* of the `fleet`\n")).toBe(
      "Vision of the fleet"
    );
  });
});

describe("operator-set positions", () => {
  const entry = (
    kind: string,
    name: string,
    title: string,
    order: number | null = null
  ) =>
    ({
      kind,
      name,
      title,
      order,
      hasBody: true,
      state: "authored",
      body: "x",
      updatedAt: null,
    }) as never;

  it("reads an order as the POSITION the operator meant", () => {
    // "non-goals second", set on that document alone. Everything else keeps
    // the default reading order around it — so the vision still leads.
    const sorted = sortIntentEntries([
      entry("product_intent", "non-goals", "Non-goals", 2),
      entry("product_intent", "open-questions", "Open questions"),
      entry("product_intent", "vision", "Vision"),
    ]);
    expect(sorted.map((e) => e.name)).toEqual([
      "vision",
      "non-goals",
      "open-questions",
    ]);
  });

  it("honours a fully ordered kind", () => {
    const sorted = sortIntentEntries([
      entry("product_intent", "charter", "Charter", 3),
      entry("product_intent", "vision", "Vision", 1),
      entry("product_intent", "non-goals", "Non-goals", 2),
    ]);
    expect(sorted.map((e) => e.name)).toEqual([
      "vision",
      "non-goals",
      "charter",
    ]);
  });

  it("clamps a position outside the section", () => {
    const first = sortIntentEntries([
      entry("product_intent", "charter", "Charter", 0),
      entry("product_intent", "vision", "Vision"),
    ]);
    expect(first.map((e) => e.name)).toEqual(["charter", "vision"]);
    const last = sortIntentEntries([
      entry("product_intent", "charter", "Charter", 99),
      entry("product_intent", "vision", "Vision"),
    ]);
    expect(last.map((e) => e.name)).toEqual(["vision", "charter"]);
  });

  it("keeps an unreadable document in its default place", () => {
    // It can never carry an order (list rows carry no attrs), so it must not
    // be exiled to the end of a section where a sibling has one.
    const unreadable = {
      ...(entry("product_intent", "vision", "Vision") as object),
      state: "unreadable",
      hasBody: false,
      body: "",
    } as never;
    const sorted = sortIntentEntries([
      entry("product_intent", "non-goals", "Non-goals", 2),
      unreadable,
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["vision", "non-goals"]);
  });

  it("leaves a kind with no operator order on the seeded reading order", () => {
    const sorted = sortIntentEntries([
      entry("product_intent", "non-goals", "Non-goals"),
      entry("product_intent", "vision", "Vision"),
      entry("success_metric", "b-metric", "B", 1),
    ]);
    expect(
      sorted.filter((e) => e.kind === "product_intent").map((e) => e.name)
    ).toEqual(["vision", "non-goals"]);
  });

  it("sorts unlisted documents after listed ones, by title", () => {
    const sorted = sortIntentEntries([
      entry("audience_profile", "z-team", "The operating team"),
      entry("audience_profile", "a-agent", "The AI development agent"),
    ]);
    expect(sorted.map((e) => e.title)).toEqual([
      "The AI development agent",
      "The operating team",
    ]);
  });
});

describe("a setext underline cannot rescue a non-heading opener", () => {
  it.each([
    "> Draft note\n===\n\nBody.",
    "- First item\n===\n\nBody.",
    "1. First\n===\n\nBody.",
    "<!-- internal -->\n===\n\nBody.",
  ])("leaves %j in the body", (body) => {
    expect(bodyWithoutLeadHeading(body)).toBe(body);
    expect(titleOfDocument("vision", body)).toBe("Vision");
  });
});

describe("deep tail", () => {
  const entry = (name: string, title: string, order: number | null = null) =>
    ({
      kind: "product_intent",
      name,
      title,
      order,
      hasBody: true,
      state: "authored",
      body: "x",
      updatedAt: null,
    }) as never;

  it("keeps documents sharing a position in title order", () => {
    const sorted = sortIntentEntries([
      entry("c", "Ccc", 1),
      entry("a", "Aaa", 1),
      entry("b", "Bbb", 1),
    ]);
    expect(sorted.map((e) => e.title)).toEqual(["Aaa", "Bbb", "Ccc"]);
  });

  it("does not read a code fence as a setext heading", () => {
    const body = "```bash\n===\necho hi\n```\n";
    expect(bodyWithoutLeadHeading(body)).toBe(body);
    expect(titleOfDocument("vision", body)).toBe("Vision");
  });
});

describe("positionsAfterMove", () => {
  const entry = (name: string, order: number | null) =>
    toIntentEntry(
      served({ id: `product_intent:${name}`, name, overview_order: order })
    );

  it("numbers every document so a move cannot tie with a neighbour", () => {
    // Nobody has set a position yet: moving the second up writes all three.
    const section = [
      entry("vision", null),
      entry("non-goals", null),
      entry("q", null),
    ];
    const writes = positionsAfterMove(section, 1, 0);
    expect(writes.map((w) => [w.entry.name, w.order])).toEqual([
      ["non-goals", 1],
      ["vision", 2],
      ["q", 3],
    ]);
  });

  it("writes only what changes", () => {
    const section = [entry("a", 1), entry("b", 2), entry("c", 3)];
    expect(
      positionsAfterMove(section, 2, 1).map((w) => [w.entry.name, w.order])
    ).toEqual([
      ["c", 2],
      ["b", 3],
    ]);
  });

  it("does nothing at the ends", () => {
    const section = [entry("a", 1), entry("b", 2)];
    expect(positionsAfterMove(section, 0, -1)).toEqual([]);
    expect(positionsAfterMove(section, 1, 2)).toEqual([]);
  });

  it("produces the order the page then sorts into", () => {
    const section = [
      entry("vision", null),
      entry("non-goals", null),
      entry("q", null),
    ];
    const writes = positionsAfterMove(section, 0, 2);
    const byName = new Map(writes.map((w) => [w.entry.name, w.order]));
    const after = section.map((e) => ({
      ...e,
      order: byName.get(e.name) ?? e.order,
    }));
    expect(sortIntentEntries(after).map((e) => e.name)).toEqual([
      "non-goals",
      "q",
      "vision",
    ]);
  });
});
