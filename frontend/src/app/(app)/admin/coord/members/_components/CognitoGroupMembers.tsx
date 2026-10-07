"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchCognitoGroupUsers,
  removeCognitoGroupUser,
} from "@/lib/api/operations/cognitoGroups";
import type { CognitoGroupUserRow, CognitoGroupUsersResponse } from "../_types";
import { requireRows } from "../_lib/groupName";
import { backendErrorMessage } from "@/lib/errors/backend-error-message";
import { log } from "../_lib/log";

// ===========================================================================
// Section e — Cognito Groups (superuser-only)
// ===========================================================================

/**
 * Expandable members list for a single Cognito group.
 *
 * Lazily fetches `GET /coord/cognito/groups/{name}/users` when first opened and
 * supports removing a user by email via `DELETE .../users {email}`.
 */
export function CognitoGroupMembers({
  groupName,
  onChanged,
}: {
  groupName: string;
  /** Tell the section its member counts are stale (a removal happened). */
  onChanged?: () => void;
}) {
  const [users, setUsers] = useState<CognitoGroupUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCognitoGroupUsers(groupName);
      // This route answers 400 naming the reason for a `group_name` Cognito
      // could never hold, so a bare `HTTP ${res.status}` throws that sentence
      // away and renders the section error as literally "HTTP 400" — the
      // status the backend stopped relying on precisely because it says
      // nothing. `backendErrorMessage` is what the mutations on this page
      // already use.
      if (!res.ok) throw new Error(await backendErrorMessage(res));
      const json = (await res.json()) as CognitoGroupUsersResponse;
      // "No users in this group yet." is an assertion about a group an operator
      // is deciding whether to empty or delete. It must come from a read that
      // landed, not from a 200 that forgot the list.
      setUsers(requireRows<CognitoGroupUserRow>(json?.users, "cognito group users"));
    } catch (err) {
      log.warn("load cognito group users failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [groupName]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeUser = useCallback(
    async (email: string) => {
      setBusy(email);
      try {
        const res = await removeCognitoGroupUser(groupName, email);
        // ONE prefix, not two — the `catch` below adds "Remove failed:". This
        // route already answered 404 (no such user) and 409 (ambiguous email)
        // with a real sentence, and now answers 400 for an email or group name
        // Cognito rejects as malformed; nesting `HTTP 404 {"detail":…}` in
        // between made the reason the least readable part of the toast. The
        // add-member handler on the sibling component reads its errors this
        // way already — this was the last Cognito membership call that did not.
        if (!res.ok) {
          throw new Error(await backendErrorMessage(res));
        }
        toast.success(`Removed ${email} from ${groupName}`);
        await load();
        onChanged?.();
      } catch (err) {
        log.warn("remove cognito group user failed", err);
        toast.error(
          `Remove failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [groupName, load, onChanged]
  );

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive flex items-center gap-1.5 py-2">
        <AlertTriangle className="h-4 w-4" /> {error}
      </p>
    );
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No users in this group yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 py-2" data-testid={`cognito-users-${groupName}`}>
      {users.map((u) => {
        const label = u.email ?? u.username;
        return (
          <div
            key={u.username}
            className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-medium truncate">{label}</span>
              {u.status ? (
                <Badge variant="outline" className="text-[0.7rem]">
                  {u.status}
                </Badge>
              ) : null}
              {u.enabled === false ? (
                <Badge variant="secondary" className="text-[0.7rem]">
                  disabled
                </Badge>
              ) : null}
            </div>
            {u.email ? (
              <DestructiveButton
                size="icon"
                aria-label={`Remove ${label} from ${groupName}`}
                title={`Remove ${label} from ${groupName}`}
                disabled={busy === u.email}
                onClick={() => removeUser(u.email as string)}
                className="size-6 shrink-0"
                data-testid={`cognito-remove-user-${groupName}-${u.username}`}
              >
                <X className="h-3.5 w-3.5" />
              </DestructiveButton>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
