"use client";

import {
  PERMISSION_PROMPT_CAPTURE_DOMAIN,
  type PermissionPromptCaptureLevel,
} from "../types";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";

/**
 * The `permission_prompt_capture` fleet-policy toggle (`on` | `off`).
 *
 * Plan `2026-10-14-permission-prompts-are-never-recorded-so-guard-rules-grow-on-anecdote`
 * Phase 5. A binding of the shared tenant-band dial; the read-back honesty
 * properties live — and are documented — in `useTenantFleetPolicyDial`. It is
 * tenant-band for the reason that hook records: the runner picks a session's
 * settings carrier (and so whether it registers the capture hook) at spawn,
 * before the session is scoped to any repo.
 */
export function usePermissionPromptCapturePolicy() {
  return useTenantFleetPolicyDial<PermissionPromptCaptureLevel>(
    PERMISSION_PROMPT_CAPTURE_DOMAIN,
    "permission-prompt capture",
    "runners"
  );
}
