import { describe, expect, it } from "vitest";
import { parseAllocationsCsv, parseRolesCsv, splitCsvLine } from "./csv";

describe("splitCsvLine", () => {
  it("honours quotes, embedded commas and doubled quotes", () => {
    expect(splitCsvLine('BE,"Engineer, backend","Says ""no"" a lot",750')).toEqual(
      ["BE", "Engineer, backend", 'Says "no" a lot', "750"]
    );
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

describe("parseRolesCsv", () => {
  it("reads the table a delivery plan is written in", () => {
    const { rows, issues } = parseRolesCsv(`
code,name,responsibility,day_rate,currency,client_side
DL,Delivery lead,Runs the delivery,900,EUR,false
BE,Backend engineer,Builds the services,"1,250.50",EUR,no
CS,Client sponsor,Approves each gate,,,yes
`);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        code: "DL",
        name: "Delivery lead",
        responsibility: "Runs the delivery",
        day_rate_micros: 900_000_000,
        currency: "EUR",
        client_side: false,
      },
      {
        code: "BE",
        name: "Backend engineer",
        responsibility: "Builds the services",
        day_rate_micros: 1_250_500_000,
        currency: "EUR",
        client_side: false,
      },
      {
        code: "CS",
        name: "Client sponsor",
        responsibility: "Approves each gate",
        day_rate_micros: null,
        currency: null,
        client_side: true,
      },
    ]);
  });

  it("works without a header row", () => {
    const { rows } = parseRolesCsv("DL,Delivery lead");
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("DL");
  });

  it("refuses a rate with no currency rather than guessing one", () => {
    const { rows, issues } = parseRolesCsv("DL,Delivery lead,,900");
    expect(rows).toEqual([]);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("three-letter code");
  });

  it("refuses a rate it cannot read", () => {
    const { rows, issues } = parseRolesCsv("DL,Delivery lead,,about nine hundred,EUR");
    expect(rows).toEqual([]);
    expect(issues[0].message).toContain("not read as a day rate");
  });

  it("rejects a duplicate code and keeps the first", () => {
    const { rows, issues } = parseRolesCsv("DL,One\nDL,Two");
    expect(rows.map((r) => r.name)).toEqual(["One"]);
    expect(issues[0].message).toContain("more than once");
    expect(issues[0].line).toBe(2);
  });

  it("names a row with no code", () => {
    const { rows, issues } = parseRolesCsv(",No code here");
    expect(rows).toEqual([]);
    expect(issues[0].message).toContain("no role code");
  });

  it("warns, but still imports, when the client-side column is not yes or no", () => {
    const { rows, issues } = parseRolesCsv("DL,Delivery lead,,,,maybe");
    expect(rows).toHaveLength(1);
    expect(rows[0].client_side).toBe(false);
    expect(issues[0].severity).toBe("warning");
  });

  it("falls back to the code when no name is given", () => {
    const { rows } = parseRolesCsv("DL");
    expect(rows[0].name).toBe("DL");
  });
});

describe("parseAllocationsCsv", () => {
  it("reads the phase × role matrix", () => {
    const { rows, issues } = parseAllocationsCsv(`
role,A0,A1,A2
DL,0.5,0.5,1
BE,,2,2
`);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { phase_code: "A0", role_code: "DL", fte: "0.5" },
      { phase_code: "A1", role_code: "DL", fte: "0.5" },
      { phase_code: "A2", role_code: "DL", fte: "1" },
      { phase_code: "A1", role_code: "BE", fte: "2" },
      { phase_code: "A2", role_code: "BE", fte: "2" },
    ]);
  });

  it("treats a blank cell as 'not on this phase', not as zero", () => {
    const { rows } = parseAllocationsCsv("role,A0,A1\nDL,,1");
    expect(rows).toEqual([{ phase_code: "A1", role_code: "DL", fte: "1" }]);
  });

  it("treats an explicit 0 the same way — no allocation row", () => {
    const { rows } = parseAllocationsCsv("role,A0,A1\nDL,0,1");
    expect(rows.map((r) => r.phase_code)).toEqual(["A1"]);
  });

  it("refuses when the first row names no phases", () => {
    const { rows, issues } = parseAllocationsCsv("role\nDL,1");
    expect(rows).toEqual([]);
    expect(issues[0].message).toContain("name the phases");
  });

  it("names a cell it cannot read and keeps the rest of the row", () => {
    const { rows, issues } = parseAllocationsCsv("role,A0,A1\nDL,half,1");
    expect(rows).toEqual([{ phase_code: "A1", role_code: "DL", fte: "1" }]);
    expect(issues[0].message).toContain("half");
    expect(issues[0].severity).toBe("error");
  });

  it("warns when a row is longer than the header", () => {
    const { issues } = parseAllocationsCsv("role,A0\nDL,1,2");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("more values");
  });

  it("rejects a repeated role row", () => {
    const { rows, issues } = parseAllocationsCsv("role,A0\nDL,1\nDL,2");
    expect(rows).toEqual([{ phase_code: "A0", role_code: "DL", fte: "1" }]);
    expect(issues[0].message).toContain("more than once");
  });

  it("returns nothing for empty input, with nothing to report", () => {
    expect(parseAllocationsCsv("   \n\n")).toEqual({ rows: [], issues: [] });
  });
});
