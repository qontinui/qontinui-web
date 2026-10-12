/**
 * Test fixtures: the row schemas the server serves for the estimate's tables,
 * in the exact shape pydantic emits them (`$defs` inside the update schema, a
 * bounded decimal as `anyOf: [number, string]` carrying `x-numeric`), trimmed
 * to the fields the tests touch.
 */

import type { JsonSchema } from "../api";

const decimal = (
  exclusiveMaximum: number,
  precision: number,
  scale: number
) => ({
  anyOf: [
    { type: "number", minimum: 0, exclusiveMaximum },
    { type: "string", pattern: "^(?!^[-+.]*$)[+-]?0*\\d*\\.?\\d*$" },
  ],
  "x-numeric": { precision, scale },
});

export const ESTIMATE_UPDATE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  $defs: {
    RoleWrite: {
      type: "object",
      properties: {
        code: { type: "string", minLength: 1, maxLength: 50 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        day_rate_micros: {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 9007199254740991 },
            { type: "null" },
          ],
        },
      },
    },
    AllocationWrite: {
      type: "object",
      properties: {
        phase_code: { type: "string", minLength: 1, maxLength: 50 },
        role_code: { type: "string", minLength: 1, maxLength: 50 },
        fte: decimal(100000, 8, 3),
      },
    },
    TaskEffortWrite: {
      type: "object",
      properties: {
        role_code: { type: "string", minLength: 1, maxLength: 50 },
        planned_person_days: decimal(100000000, 10, 2),
      },
    },
  },
};

export const ROLE_SCHEMA = (
  ESTIMATE_UPDATE_SCHEMA.$defs as Record<string, JsonSchema>
).RoleWrite;
export const ALLOCATION_SCHEMA = (
  ESTIMATE_UPDATE_SCHEMA.$defs as Record<string, JsonSchema>
).AllocationWrite;
