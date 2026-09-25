import { describe, expect, it } from "vitest";
import { checkField, checkFields } from "./validation";
import type { JsonSchema } from "./api";

/**
 * Shapes as pydantic actually serves them from `GET /overview/resources` —
 * an optional field is `anyOf: [T, {type: "null"}]`, and a bounded decimal
 * carries its limit on the NUMBER branch and `x-numeric` on the wrapper.
 */
const intentUpdate: JsonSchema = {
  type: "object",
  properties: {
    body: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 200000 },
        { type: "null" },
      ],
    },
    overview_order: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 999 }, { type: "null" }],
    },
  },
};

const personDays: JsonSchema = {
  anyOf: [
    { type: "number", minimum: 0, exclusiveMaximum: 100000000 },
    { type: "string" },
  ],
  "x-numeric": { precision: 10, scale: 2 },
};

describe("checkField", () => {
  it("applies the served string bounds", () => {
    const body = intentUpdate.properties!.body;
    expect(checkField(body, "Some text", "The text")).toBeNull();
    expect(checkField(body, "x".repeat(200001), "The text")).toMatch(
      /too long/
    );
  });

  it("applies the served integer bounds", () => {
    const order = intentUpdate.properties!.overview_order;
    expect(checkField(order, 3, "Position")).toBeNull();
    expect(checkField(order, 0, "Position")).toMatch(/at least 1/);
    expect(checkField(order, 1000, "Position")).toMatch(/at most 999/);
    expect(checkField(order, 1.5, "Position")).toMatch(/whole number/);
  });

  it("refuses a decimal the column cannot hold, as the API would", () => {
    expect(checkField(personDays, "12.5", "Person-days")).toBeNull();
    expect(checkField(personDays, "10000000000", "Person-days")).toMatch(
      /less than/
    );
    expect(checkField(personDays, "-1", "Person-days")).toMatch(/at least 0/);
    expect(checkField(personDays, "lots", "Person-days")).toMatch(/number/);
  });

  it("leaves emptiness to the form", () => {
    expect(
      checkField(intentUpdate.properties!.overview_order, "", "Position")
    ).toBeNull();
    expect(checkField(intentUpdate.properties!.body, null, "Text")).toBeNull();
  });

  it("does not judge a field the server did not describe", () => {
    expect(checkField(undefined, "anything", "X")).toBeNull();
  });
});

describe("an optional bounded decimal", () => {
  // What pydantic actually serves for `contingency_pct: ContingencyPct | None`:
  // the decimal's own anyOf, wrapped again in the optional anyOf.
  const contingency: JsonSchema = {
    anyOf: [
      {
        anyOf: [
          { type: "number", minimum: 0, exclusiveMaximum: 1000 },
          { type: "string" },
        ],
        "x-numeric": { precision: 6, scale: 3 },
      },
      { type: "null" },
    ],
  };

  it("still applies the bounds under both wrappers", () => {
    expect(checkField(contingency, "12.5", "Contingency")).toBeNull();
    expect(checkField(contingency, "5000", "Contingency")).toMatch(/less than/);
    expect(checkField(contingency, "-1", "Contingency")).toMatch(/at least 0/);
    expect(checkField(contingency, null, "Contingency")).toBeNull();
  });
});

describe("checkFields", () => {
  it("reports each failing field by name, with the reader's label", () => {
    expect(
      checkFields(
        intentUpdate,
        { body: "fine", overview_order: 0 },
        { overview_order: "Position" }
      )
    ).toEqual({ overview_order: "Position must be at least 1." });
  });
});
