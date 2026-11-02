"use client";

import {
  PERMISSION_AUTO_ACCEPT_DOMAIN,
  type PermissionAutoAcceptLevel,
} from "../types";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";

/**
 * The `permission_auto_accept` fleet-policy switch (`on` | `off`).
 *
 * Plan `2026-10-23-runner-sessions-stop-at-permission-dialogs-so-accept-them-by-default-with-a-tenant-switch`
 * Phase 3. A binding of the shared tenant-band dial; the read-back honesty
 * properties live — and are documented — in `useTenantFleetPolicyDial`. It is
 * tenant-band because the runner decides each prompt for a session, and a
 * session is not scoped to any repo.
 */
export function usePermissionAutoAcceptPolicy() {
  return useTenantFleetPolicyDial<PermissionAutoAcceptLevel>(
    PERMISSION_AUTO_ACCEPT_DOMAIN,
    "permission auto-accept",
    "runners"
  );
}
