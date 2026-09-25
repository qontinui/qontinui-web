import { describe, expect, it } from "vitest";
import {
  pendingDomainWrites,
  type NextStepDomain,
  type NextStepSettings,
} from "./useNextStepSettings";

function domain(fields: Partial<NextStepDomain>): NextStepDomain {
  return {
    decision_domain: "pr_fix",
    label: "PR fix",
    description: "",
    autonomy_level: "auto_decide",
    default_autonomy_level: "auto_decide",
    mode: "guidance",
    resolved_from: "system",
    requires_master: true,
    effective: false,
    ...fields,
  };
}

function settings(domains: NextStepDomain[]): NextStepSettings {
  return { master_enabled: true, can_edit: true, domains };
}

describe("pendingDomainWrites", () => {
  it("sends a changed level", () => {
    const s = settings([domain({ autonomy_level_source: "policy_row" })]);
    expect(
      pendingDomainWrites(s, { pr_fix: "guidance_only" }, new Set())
    ).toEqual([{ decision_domain: "pr_fix", autonomy_level: "guidance_only" }]);
  });

  it("sends an unchanged level the operator chose for a code-fallback domain", () => {
    const s = settings([domain({ autonomy_level_source: "code_fallback" })]);
    expect(
      pendingDomainWrites(s, { pr_fix: "auto_decide" }, new Set(["pr_fix"]))
    ).toEqual([{ decision_domain: "pr_fix", autonomy_level: "auto_decide" }]);
  });

  it("does not send an untouched code-fallback domain", () => {
    const s = settings([domain({ autonomy_level_source: "code_fallback" })]);
    expect(
      pendingDomainWrites(s, { pr_fix: "auto_decide" }, new Set())
    ).toEqual([]);
  });

  it("does not send an unchanged, touched domain that already has a row", () => {
    const s = settings([domain({ autonomy_level_source: "policy_row" })]);
    expect(
      pendingDomainWrites(s, { pr_fix: "auto_decide" }, new Set(["pr_fix"]))
    ).toEqual([]);
  });

  it("treats an absent source (older coord) as a row: unchanged is not sent", () => {
    const s = settings([domain({})]);
    expect(
      pendingDomainWrites(s, { pr_fix: "auto_decide" }, new Set(["pr_fix"]))
    ).toEqual([]);
  });

  it("returns nothing before settings load", () => {
    expect(pendingDomainWrites(null, {}, new Set(["pr_fix"]))).toEqual([]);
  });
});
