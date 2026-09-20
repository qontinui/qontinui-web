import { describe, expect, it } from "vitest";
import {
  bodyWithoutLeadHeading,
  classifyIntent,
  sortIntentEntries,
  titleOfDocument,
  hasContent,
  skeletonEntry,
  stripFrontmatter,
  toIntentEntry,
  unreadableEntry,
} from "./intent";
import type { PromptDocument } from "@/app/(app)/admin/coord/prompt-documents/types";

describe("classifyIntent", () => {
  it("trusts coord's served verdict over the version fallback", () => {
    expect(
      classifyIntent({
        default_source: "prompt_doc/product_intent/main/v1",
        current_version: 1,
        unedited_seed: false,
      })
    ).toBe("authored");
    expect(
      classifyIntent({
        default_source: "prompt_doc/product_intent/main/v1",
        current_version: 4,
        unedited_seed: true,
      })
    ).toBe("skeleton");
  });

  it("falls back to origin and version when coord serves no verdict", () => {
    expect(classifyIntent({ default_source: null, current_version: 1 })).toBe(
      "authored"
    );
    expect(
      classifyIntent({ default_source: "seed/v1", current_version: 1 })
    ).toBe("skeleton");
    // Edited since seeding, but only the body could say how much: never guessed.
    expect(
      classifyIntent({ default_source: "seed/v1", current_version: 2 })
    ).toBe("unknown");
    expect(
      classifyIntent({
        default_source: "seed/v1",
        current_version: 2,
        unedited_seed: null,
      })
    ).toBe("unknown");
  });
});

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
  const base = {
    id: "d1",
    tenant_id: "t1",
    kind: "product_intent",
    name: "main",
    description: "What we are building",
    format: "markdown",
    current_version: 1,
    updated_at: "2026-09-19T10:00:00Z",
  } as unknown as PromptDocument;

  it("never passes a skeleton's template text through", () => {
    const entry = toIntentEntry({
      ...base,
      default_source: "seed/v1",
      body: "# Product intent\n\n_Describe the product here._",
    });
    expect(entry.state).toBe("skeleton");
    expect(entry.body).toBe("");
  });

  it("keeps an authored body, minus frontmatter", () => {
    const entry = toIntentEntry({
      ...base,
      default_source: null,
      body: "---\nowner: x\n---\nA portal for partners.",
    });
    expect(entry.state).toBe("authored");
    expect(entry.body).toBe("A portal for partners.");
  });
});

describe("hasContent", () => {
  const summary = {
    id: "d2",
    kind: "initiative",
    name: "x",
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_at: "2026-09-19T10:00:00Z",
  } as unknown as PromptDocument;

  it("treats an authored document with an empty body as not written", () => {
    const entry = toIntentEntry({
      ...summary,
      body: "---\nowner: x\n---\n   \n",
    });
    expect(entry.state).toBe("authored");
    expect(hasContent(entry)).toBe(false);
  });

  it("never lets a skeleton read as written", () => {
    expect(hasContent(skeletonEntry(summary))).toBe(false);
  });

  it("reports an unreadable document instead of calling it unwritten", () => {
    const entry = unreadableEntry(summary, "GET /x failed: 502 - {}");
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
      description: null,
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
  const doc = (body: string) =>
    ({
      id: "d",
      kind: "product_intent",
      name: "vision",
      description: null,
      format: "markdown",
      default_source: null,
      current_version: 2,
      updated_at: "2026-09-20T10:00:00Z",
      body,
    }) as unknown as PromptDocument;

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
