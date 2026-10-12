"use client";

import {
  COMMAND_SAFETY_REWRITE_DOMAIN,
  type CommandSafetyRewriteLevel,
} from "../types";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";

/**
 * The `command_safety_rewrite` fleet-policy toggle (`on` | `off`).
 *
 * Plan `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts`
 * Phase 4. A binding of the shared tenant-band dial; the read-back honesty
 * properties live — and are documented — in `useTenantFleetPolicyDial`. It is
 * tenant-band for the reason that hook records: the runner picks a session's
 * settings carrier at spawn, before the session is scoped to any repo.
 */
export function useCommandSafetyRewritePolicy() {
  return useTenantFleetPolicyDial<CommandSafetyRewriteLevel>(
    COMMAND_SAFETY_REWRITE_DOMAIN,
    "command-safety rewrite",
    "runners"
  );
}
