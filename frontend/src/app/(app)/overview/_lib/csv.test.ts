import { describe, expect, it } from "vitest";
import {
  parseAllocationsCsv,
  parseEffortsCsv,
  parseRolesCsv,
  splitCsvLine,
  sumPersonDays,
} from "./csv";

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
    const { rows, issues } = parseRolesCsv(
      "DL,Delivery lead,,about nine hundred,EUR"
    );
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

describe("parseEffortsCsv", () => {
  it("reads the task x role split in long form", () => {
    const { rows, issues } = parseEffortsCsv(`
phase,task,role,days
A0,1.1,DL,4
A0,1.1,BE,6.5
A1,2.1,BE,10
`);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "DL",
        planned_person_days: "4",
      },
      {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "BE",
        planned_person_days: "6.5",
      },
      {
        phase_code: "A1",
        task_number: "2.1",
        role_code: "BE",
        planned_person_days: "10",
      },
    ]);
  });

  it("needs all three keys before a number", () => {
    const { rows, issues } = parseEffortsCsv("A0,,DL,4");
    expect(rows).toEqual([]);
    expect(issues[0].message).toContain("phase, a task number and a role");
  });

  it("refuses days it cannot read rather than counting them as none", () => {
    const { rows, issues } = parseEffortsCsv("A0,1.1,DL,a few");
    expect(rows).toEqual([]);
    expect(issues[0].message).toContain("not read as a number of days");
  });

  it("rejects the same role twice on one task", () => {
    const { rows, issues } = parseEffortsCsv("A0,1.1,DL,4\nA0,1.1,DL,5");
    expect(rows).toHaveLength(1);
    expect(issues[0].message).toContain("already given days");
  });

  it("drops a zero, which is not an allocation of time", () => {
    const { rows } = parseEffortsCsv("A0,1.1,DL,0\nA0,1.1,BE,3");
    expect(rows.map((r) => r.role_code)).toEqual(["BE"]);
  });
});

describe("sumPersonDays", () => {
  it("totals exactly, with no float in the path", () => {
    // 0.1 + 0.2 is the reason this is not a `reduce` over `Number`.
    expect(sumPersonDays(["0.1", "0.2"])).toBe("0.3");
    expect(sumPersonDays(["10.00", "6.50", "3.50"])).toBe("20");
    expect(sumPersonDays([])).toBe("0");
  });

  it("accepts every value the effort paste box accepts", () => {
    // `.5` is the one a narrower accept-set rejected, which made the WHOLE
    // total read "unreadable" over data the page had just saved.
    for (const value of [".5", "04", "0", "12", "1.5", "4.333", "0.005"]) {
      expect(sumPersonDays([value]), value).not.toBeNull();
    }
    expect(sumPersonDays([".5", "0.25"])).toBe("0.75");
  });

  it("totals at the grain the column stores, and says so on the way in", () => {
    // NUMERIC(10, 2): Postgres rounds silently, so the paste box, the
    // running total and the store all have to speak hundredths or the
    // editor's own figure changes the moment it is saved.
    expect(sumPersonDays(["4.333", "1"])).toBe("5.33");
    expect(sumPersonDays(["0.005"])).toBe("0.01");
    const { rows, issues } = parseEffortsCsv("A0,1.1,DL,4.333");
    expect(rows).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain("4.33");
    // Two places or fewer passes without comment.
    expect(parseEffortsCsv("A0,1.1,DL,4.33").issues).toEqual([]);
    expect(parseEffortsCsv("A0,1.1,DL,.5").issues).toEqual([]);
    expect(parseEffortsCsv("A0,1.1,DL,4.3300").issues).toEqual([]);
  });

  it("does not let one wide value refuse the whole column", () => {
    // A scale shared across the column meant a single spreadsheet-exported
    // 1/3 overflowed the safe-integer range and made the TOTAL unreadable.
    expect(sumPersonDays(["10", "0.333333333333333"])).toBe("10.33");
    expect(sumPersonDays(["100000", "0.3333333333333333"])).toBe("100000.33");
  });

  it("stays exact over a long column", () => {
    expect(sumPersonDays(Array(100000).fill("0.5"))).toBe("50000");
    expect(sumPersonDays(["0.1", "0.2"])).toBe("0.3");
  });

  it("is null only when a value really cannot be read", () => {
    expect(sumPersonDays(["1", "a few"])).toBeNull();
    expect(sumPersonDays(["1", ""])).toBeNull();
    expect(sumPersonDays(["1", "."])).toBeNull();
    expect(sumPersonDays(["1", "-2"])).toBeNull();
  });
});
