import { describe, expect, it } from "vitest";
import type {
  KeyDelta,
  MachineDriftReport,
  SectionDrift,
} from "@/services/devenv-api";
import {
  buildRemediation,
  remediationToJson,
  remediationToManifest,
} from "./copy-canonical";

function section(name: string, deltas: KeyDelta[]): SectionDrift {
  return { section: name, deltas, severity: "warning" };
}

function report(sections: SectionDrift[]): MachineDriftReport {
  return {
    machine_id: "m1",
    machine_name: "monster",
    sections,
    severity: "warning",
    in_sync: sections.length === 0,
    schema_version_mismatch: false,
    expected_schema_version: 1,
    actual_schema_version: 1,
    has_config: true,
  };
}

describe("buildRemediation", () => {
  it("sets changed and removed keys to the canonical (expected) value", () => {
    const rem = buildRemediation(
      report([
        section("versions", [
          { key: "node", status: "changed", expected: "20", actual: "18", severity: "critical" },
          { key: "pnpm", status: "removed", expected: "9", actual: null, severity: "critical" },
        ]),
      ])
    );
    expect(rem.inSync).toBe(false);
    expect(rem.itemCount).toBe(2);
    expect(rem.sections[0].items).toEqual([
      { key: "node", value: "20", secret: false },
      { key: "pnpm", value: "9", secret: false },
    ]);
  });

  it("is additive — extra keys on the target (`added`) are left alone", () => {
    const rem = buildRemediation(
      report([
        section("services", [
          { key: "redis", status: "added", expected: null, actual: "on", severity: "warning" },
          { key: "postgres", status: "changed", expected: "16", actual: "15", severity: "warning" },
        ]),
      ])
    );
    expect(rem.itemCount).toBe(1);
    expect(rem.sections[0].items).toEqual([
      { key: "postgres", value: "16", secret: false },
    ]);
  });

  it("flags env_contract secrets and never copies their value", () => {
    const rem = buildRemediation(
      report([
        section("env_contract", [
          { key: "OPENAI_API_KEY", status: "removed", expected: "present", actual: null, severity: "warning" },
        ]),
      ])
    );
    expect(rem.secretCount).toBe(1);
    expect(rem.sections[0].items[0]).toEqual({
      key: "OPENAI_API_KEY",
      value: null,
      secret: true,
    });
  });

  it("reports in-sync when there are no sections", () => {
    const rem = buildRemediation(report([]));
    expect(rem.inSync).toBe(true);
    expect(rem.itemCount).toBe(0);
    expect(rem.sections).toEqual([]);
  });

  it("drops a section that only had `added` deltas", () => {
    const rem = buildRemediation(
      report([
        section("services", [
          { key: "extra", status: "added", expected: null, actual: "x", severity: "info" },
        ]),
      ])
    );
    expect(rem.sections).toEqual([]);
    expect(rem.inSync).toBe(true);
  });
});

describe("serializers", () => {
  const rem = buildRemediation(
    report([
      section("versions", [
        { key: "node", status: "changed", expected: "20", actual: "18", severity: "critical" },
      ]),
      section("env_contract", [
        { key: "OPENAI_API_KEY", status: "removed", expected: "present", actual: null, severity: "warning" },
      ]),
    ])
  );

  it("manifest emits KEY=value for real values and elides secrets", () => {
    const manifest = remediationToManifest(rem);
    expect(manifest).toContain("# [versions]");
    expect(manifest).toContain("node=20");
    expect(manifest).toContain("# [env_contract]");
    expect(manifest).toContain(
      "# OPENAI_API_KEY=<secret — set manually; value not stored>"
    );
    expect(manifest).not.toContain("OPENAI_API_KEY=present");
  });

  it("json serializes secret values as null", () => {
    const parsed = JSON.parse(remediationToJson(rem));
    expect(parsed.machine).toBe("monster");
    const env = parsed.sections.find(
      (s: { section: string }) => s.section === "env_contract"
    );
    expect(env.set.OPENAI_API_KEY).toBeNull();
    const versions = parsed.sections.find(
      (s: { section: string }) => s.section === "versions"
    );
    expect(versions.set.node).toBe("20");
  });
});
