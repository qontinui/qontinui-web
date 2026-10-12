import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView";
import { findWikiLinks, slugify, wikiHref } from "./wiki-links";

describe("slugify", () => {
  // The same vectors the server's tests pin (`test_overview_documents.py`
  // `TestSlugs`): a link and the page it names must reach one slug. Change
  // both together.
  it("folds a title exactly as the server does", () => {
    expect(slugify("Café — Q4 Launch!")).toBe("cafe-q4-launch");
    expect(slugify("Видение проекта")).toBe("видение-проекта");
    expect(slugify("snake_case  title")).toBe("snake-case-title");
    expect(slugify("a_ b__-c")).toBe("a-b-c");
    expect(slugify("İstanbul")).toBe("istanbul");
    expect(slugify("ΟΔΟΣ")).toBe("οδος"); // final sigma
    expect(slugify("½ cup")).toBe("1-2-cup");
    expect(slugify("ﬁle №5")).toBe("file-no5");
    // The cut lands on a hyphen, which is trimmed.
    expect(slugify("a".repeat(119) + " b" + "c".repeat(10))).toBe(
      "a".repeat(119)
    );
    expect(slugify("***")).toBe("");
  });

  it("caps at 120 characters, not UTF-16 units", () => {
    // U+20000 has no compatibility decomposition, so it survives NFKD as one
    // astral code point (two UTF-16 units): a unit-counting cut gives 110.
    const slug = slugify("𠀀".repeat(10) + "b".repeat(200));
    expect(Array.from(slug)).toHaveLength(120);
    expect(slug.startsWith("𠀀".repeat(10))).toBe(true);
  });
});

describe("findWikiLinks", () => {
  it("reads titles, labels and slugs, skipping links that name nothing", () => {
    const links = findWikiLinks(
      "See [[Getting Started]], [[Budget|the budget]] and [[***]]."
    );
    expect(links.map((l) => [l.title, l.label, l.slug])).toEqual([
      ["Getting Started", "Getting Started", "getting-started"],
      ["Budget", "the budget", "budget"],
    ]);
  });
});

describe("findWikiLinks limits", () => {
  it("counts a title's length in characters, as the server does", () => {
    const title = "𠀀".repeat(150); // 150 characters, 300 UTF-16 units
    expect(findWikiLinks(`[[${title}]]`)).toHaveLength(1);
    expect(findWikiLinks(`[[${"x".repeat(201)}]]`)).toHaveLength(0);
  });
});

describe("MarkdownView wiki links", () => {
  const existing = new Set(["budget"]);
  const exists = (slug: string) => existing.has(slug);

  it("links a page that exists, and offers a missing one to an editor", () => {
    render(
      <MarkdownView wikiLinks={{ exists, canCreate: true }}>
        {"Read [[Budget|the budget]] then [[Risks]]."}
      </MarkdownView>
    );
    const present = screen.getByRole("link", { name: "the budget" });
    expect(present.getAttribute("href")).toBe(wikiHref("budget"));
    expect(present.getAttribute("data-wiki-link")).toBe("present");
    const missing = screen.getByRole("link", { name: "Risks" });
    expect(missing.getAttribute("href")).toBe(
      wikiHref("risks", { title: "Risks" })
    );
    expect(missing.getAttribute("data-wiki-link")).toBe("missing");
  });

  it("shows a missing page as plain text to a reader", () => {
    render(
      <MarkdownView wikiLinks={{ exists, canCreate: false }}>
        {"Then [[Risks]]."}
      </MarkdownView>
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Risks").getAttribute("data-wiki-link")).toBe(
      "missing"
    );
  });

  it("leaves code as written", () => {
    const { container } = render(
      <MarkdownView wikiLinks={{ exists, canCreate: true }}>
        {"Type `[[Budget]]` to link.\n\n```\n[[Budget]]\n```"}
      </MarkdownView>
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("[[Budget]]");
  });

  it("shows [[…]] as written when wiki links are not asked for", () => {
    const { container } = render(<MarkdownView>{"[[Budget]]"}</MarkdownView>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("[[Budget]]");
  });
});
