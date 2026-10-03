import { describe, expect, it } from "vitest";
import { nonEmptyLines, splitCsvLine } from "./csv";

describe("splitCsvLine", () => {
  it("honours quotes, embedded commas and doubled quotes", () => {
    expect(
      splitCsvLine('BE,"Engineer, backend","Says ""no"" a lot",750')
    ).toEqual(["BE", "Engineer, backend", 'Says "no" a lot', "750"]);
  });

  it("accepts tabs, so a spreadsheet paste works", () => {
    expect(splitCsvLine("BE\tBackend\t\t750")).toEqual([
      "BE",
      "Backend",
      "",
      "750",
    ]);
  });
});
describe("nonEmptyLines", () => {
  it("keeps each line's own number across blank lines and CRLF", () => {
    expect(nonEmptyLines("a\r\n\r\nb\n  \nc")).toEqual([
      { line: 1, text: "a" },
      { line: 3, text: "b" },
      { line: 5, text: "c" },
    ]);
  });
});
