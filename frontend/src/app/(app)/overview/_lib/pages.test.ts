import { describe, expect, it } from "vitest";
import {
  alphabeticalIndex,
  documentMeta,
  formatBytes,
  uploadProblem,
} from "./pages";

describe("alphabeticalIndex", () => {
  const titles = (items: { title: string }[]) => items.map((i) => i.title);

  it("files titles A–Z under their first letter, accents folded", () => {
    const groups = alphabeticalIndex([
      { title: "Budget" },
      { title: "Éclair" },
      { title: "agile" },
      { title: "Escrow" },
    ]);
    expect(groups.map((g) => g.letter)).toEqual(["A", "B", "E"]);
    expect(titles(groups[2]?.items ?? [])).toEqual(["Éclair", "Escrow"]);
  });

  it("puts titles that start with anything but a letter last, under #", () => {
    const groups = alphabeticalIndex([
      { title: "2026 plan" },
      { title: "Zoning" },
      { title: "(draft) Aims" },
    ]);
    expect(groups.map((g) => g.letter)).toEqual(["Z", "#"]);
    expect(titles(groups[1]?.items ?? [])).toHaveLength(2);
  });

  it("keeps one group per letter in any script", () => {
    const groups = alphabeticalIndex([
      { title: "Видение" },
      { title: "Бюджет" },
      { title: "Вехи" },
    ]);
    expect(groups.map((g) => g.letter)).toEqual(["Б", "В"]);
  });
});

describe("uploadProblem", () => {
  it("accepts the server's types up to 25 MB", () => {
    expect(uploadProblem({ name: "Plan.PDF", size: 10 })).toBeNull();
    expect(
      uploadProblem({ name: "deck.pptx", size: 25 * 1024 * 1024 })
    ).toBeNull();
  });

  it("names the file and the reason when it refuses one", () => {
    expect(uploadProblem({ name: "tool.exe", size: 10 })).toMatch(
      /^tool\.exe: only PDF/
    );
    expect(uploadProblem({ name: "big.pdf", size: 26 * 1024 * 1024 })).toMatch(
      /big\.pdf is 26 MB; files can be at most 25 MB/
    );
    expect(uploadProblem({ name: "empty.csv", size: 0 })).toBe(
      "empty.csv is empty."
    );
  });
});

describe("formatBytes and documentMeta", () => {
  it("formats sizes a reader can take in", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("lists whichever details are set", () => {
    expect(
      documentMeta({
        doc_number: "DP-001",
        doc_status: "Approved",
        owner: "Dana",
      })
    ).toBe("No. DP-001 · Approved · Owner: Dana");
    expect(
      documentMeta({ doc_number: null, doc_status: "Draft", owner: null })
    ).toBe("Draft");
  });
});
