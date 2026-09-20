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

  it("accepts a heading that follows opening prose", () => {
    expect(
      titleOfDocument("x", "Opening prose.\n\n## A section\n\nMore.")
    ).toBe("A section");
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
  const entry = (kind: string, name: string, title: string) =>
    ({
      kind,
      name,
      title,
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
