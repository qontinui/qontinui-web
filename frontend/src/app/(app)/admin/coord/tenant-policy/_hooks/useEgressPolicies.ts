"use client";

import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import { EGRESS_FLOWS, type EgressFlow, type EgressLevel } from "../types";

export type EgressDial = ReturnType<
  typeof useTenantFleetPolicyDial<EgressLevel>
>;

function spec(flow: EgressFlow) {
  const found = EGRESS_FLOWS.find((f) => f.flow === flow);
  if (!found) throw new Error(`unknown egress flow ${flow}`);
  return found;
}

function useEgressDial(flow: EgressFlow): EgressDial {
  const { domain, label } = spec(flow);
  return useTenantFleetPolicyDial<EgressLevel>(
    domain,
    label.toLowerCase(),
    "runners"
  );
}

/**
 * The six egress switches, one shared tenant-band dial each (plan
 * `2026-10-10-spec-front-end-phase-9-generic-boundary` Phase 8). Each reads the
 * level coord RESOLVES and writes at the tenant band — the egress domains
 * refuse a repo-band row — with the read-back honesty properties documented
 * in `useTenantFleetPolicyDial`.
 *
 * Six explicit calls rather than a loop, so the hook order is fixed by the
 * source and no rules-of-hooks exemption is needed.
 */
export function useEgressPolicies(): Record<EgressFlow, EgressDial> {
  const transcript_sync = useEgressDial("transcript_sync");
  const code_mirror = useEgressDial("code_mirror");
  const terminal_stream = useEgressDial("terminal_stream");
  const telemetry = useEgressDial("telemetry");
  const update_check = useEgressDial("update_check");
  const skill_mirror = useEgressDial("skill_mirror");
  return {
    transcript_sync,
    code_mirror,
    terminal_stream,
    telemetry,
    update_check,
    skill_mirror,
  };
}
