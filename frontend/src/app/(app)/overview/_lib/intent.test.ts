import { describe, expect, it } from "vitest";
import { classifyIntent, stripFrontmatter, toIntentEntry } from "./intent";
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
