// ============================================================================
// Copy-canonical-config — Phase 1 remediation derivation (pure, testable).
//
// Given a machine's drift report (already computed vs the canonical machine),
// derive the ADDITIVE set of changes that make the target match canonical:
//   - `changed` / `removed` deltas  → "set KEY to the canonical value"
//   - `added` deltas (extras the target has, canonical doesn't) → LEFT ALONE
//
// The env_contract section stores presence only (secret backstop), so its
// values can never be copied — those items are flagged `secret` (value null)
// for the operator to set by hand.
//
// There is no server→machine push: the operator/agent applies this on the box,
// the agent re-reports, and drift clears. This module only produces the plan.
// ============================================================================

import type { MachineDriftReport } from "@/services/devenv-api";

/** Section whose values are stored presence-only (the secret backstop). */
export const SECRET_SECTION = "env_contract";

export interface RemediationItem {
  key: string;
  /** Canonical value to set; null when it can't be copied (a secret). */
  value: string | null;
  /** True for the env_contract section — value is presence-only, set by hand. */
  secret: boolean;
}

export interface RemediationSection {
  section: string;
  items: RemediationItem[];
}

export interface Remediation {
  machineName: string;
  sections: RemediationSection[];
  /** Total keys to set. */
  itemCount: number;
  /** How many of those are secrets whose value can't be copied. */
  secretCount: number;
  /** True when the target already matches canonical (nothing to copy). */
  inSync: boolean;
}

/**
 * Derive the additive remediation that makes a target machine's config match
 * the canonical machine's, from an already-computed drift report.
 */
export function buildRemediation(report: MachineDriftReport): Remediation {
  const sections: RemediationSection[] = [];
  let itemCount = 0;
  let secretCount = 0;

  for (const section of report.sections) {
    const isSecret = section.section === SECRET_SECTION;
    const items: RemediationItem[] = [];
    for (const delta of section.deltas) {
      // Additive: never touch keys the target has but canonical doesn't.
      if (delta.status === "added") continue;
      // Repo-derived keys are read from the manifest next to the capturing
      // binary, so "set runner_crate_version to 1.0.5" is not an instruction
      // anyone can carry out — it converges by pulling the repo.
      if (delta.derived) continue;
      items.push({
        key: delta.key,
        // `expected` is the canonical value (present for changed/removed).
        value: isSecret ? null : (delta.expected ?? null),
        secret: isSecret,
      });
    }
    if (items.length > 0) {
      sections.push({ section: section.section, items });
      itemCount += items.length;
      secretCount += items.filter((i) => i.secret).length;
    }
  }

  return {
    machineName: report.machine_name ?? "this machine",
    sections,
    itemCount,
    secretCount,
    inSync: itemCount === 0,
  };
}

/**
 * Section-grouped `KEY=value` manifest (secrets elided to a comment). Intended
 * to be copy-pasted/read by the operator applying it on the target box.
 */
export function remediationToManifest(rem: Remediation): string {
  const lines: string[] = [
    `# Apply on ${rem.machineName} to match the canonical machine, then let its`,
    `# agent re-report — drift will clear. Additive: extra keys are left as-is.`,
  ];
  for (const section of rem.sections) {
    lines.push("", `# [${section.section}]`);
    for (const item of section.items) {
      if (item.secret) {
        lines.push(`# ${item.key}=<secret — set manually; value not stored>`);
      } else {
        lines.push(`${item.key}=${item.value ?? ""}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** JSON form for machine/agent consumption (secret values serialized as null). */
export function remediationToJson(rem: Remediation): string {
  return JSON.stringify(
    {
      machine: rem.machineName,
      sections: rem.sections.map((s) => ({
        section: s.section,
        set: Object.fromEntries(s.items.map((i) => [i.key, i.value])),
      })),
    },
    null,
    2
  );
}
