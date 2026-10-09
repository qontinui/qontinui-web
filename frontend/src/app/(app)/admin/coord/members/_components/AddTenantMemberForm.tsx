"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  addTenantMember,
  type CoordMemberRole,
  type TenantMemberAddResponse,
} from "@/lib/api/operations/coordMembers";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { TIER_OPTIONS, tierLabel } from "../_lib/tenantLabels";
import { plainSentence } from "@/lib/errors/backend-error-message";
import { log } from "../_lib/log";

// ===========================================================================
// Section c — Add a member by email (the page's PRIMARY write)
// ===========================================================================

/** What happened to the notice. `null` = this backend did not say. */
type AddMemberNotice = "sent" | "not_sent" | "not_needed" | null;

/**
 * Narrow the body's `notice` to the arms this build renders.
 *
 * A body-controlled string, so anything else — a future arm, a truncated
 * value, 50 KB of HTML — lands on `null` and renders as silence. Claiming
 * "we emailed them" from a value we do not recognise is the same overclaim
 * the whole notice exists to stop.
 */
function readNotice(value: unknown): AddMemberNotice {
  return value === "sent" || value === "not_sent" || value === "not_needed"
    ? value
    : null;
}

/** What the last submit produced, rendered inline beneath the form. */
type AddMemberOutcome =
  | {
      kind: "added";
      email: string;
      role: CoordMemberRole;
      notice: AddMemberNotice;
    }
  | { kind: "invited"; email: string; role: CoordMemberRole }
  | { kind: "invitation_pending"; email: string; role: CoordMemberRole }
  | { kind: "invite_required"; email: string }
  | { kind: "error"; message: string };

/**
 * ONE form for the one thing an administrator comes to this page to do: give a
 * colleague access. Two inputs — an email and a tier — and the backend decides
 * whether that email already has an account (add them now) or does not. For
 * one that does not, a superuser gets `invited` (the account is created, the
 * tier granted, then the email sent) and a tenant admin gets `invite_required`.
 *
 * ## Why there is no "group" field (plan Design decision 1)
 *
 * The form it replaces (`InviteForm`) asked for a raw Cognito **subject** and
 * **SSO provider**, and its own copy admitted it only worked for someone who
 * had already signed up and whose `sub` the administrator knew out-of-band —
 * i.e. it was never an invitation. Both fields are internal vocabulary on a
 * primary surface, which is exactly what console style guide **R8** forbids
 * (`docs/console-ui-style-guide.md:1060`); internal ids belong in `MemberDetail`'s
 * `raw` slot, and nowhere else on this page.
 *
 * The tier selector reuses {@link TIER_OPTIONS} rather than offering a Cognito
 * group, because a **role** is a first-class product concept this console
 * already renders (`tierLabel`, `MemberDetail`) while a **group** is plumbing
 * for a different feature — pre-authorizing an entire IdP group's current *and
 * future* members. That feature is not removed; it is one panel down, under
 * "Advanced: auto-provision by SSO group".
 *
 * Skipping groups costs nothing durability-wise: coord's login-time
 * `reconcile_group_memberships` scopes its `DELETE FROM coord.operator_roles`
 * to its own sentinel `granted_by` (`auth_sso.rs:1328`), so a role granted
 * directly is never revoked by the group sync.
 *
 * ## Why the `added` arm does not promise a row in the table
 *
 * The grant and the table answer two different questions. `GET /coord/members`
 * proxies coord's `GET /admin/coord/operators`, which lists operators by their
 * HOME tenant (`WHERE o.tenant_id = $1`) — not by role membership — and the
 * upsert behind this form deliberately never moves `tenant_id` on conflict, so
 * a colleague who already has an operator row homed elsewhere is granted the
 * role and still does not appear below. That is a real gap in the listing, not
 * in the grant, and closing it is coord's to do.
 *
 * Until it is closed the copy has to be true: the notice states the grant, and
 * says a member homed in another tenant may not show up in the list. It does
 * not say "they are in the table now", which the refetch below cannot
 * guarantee. The refetch stays — for the common case (a colleague homed here,
 * or already listed and being re-tiered) the row genuinely does appear, and a
 * table that needed a manual reload would be its own defect.
 *
 * ## Why the outcome is inline and not only a toast
 *
 * Three of the outcomes are not one-liners. `invited` has to say what the
 * invitee will receive and how to recover an invitation that never arrived;
 * `invitation_pending` has to say the account is not activated without
 * claiming an email exists (the backend cannot tell sent from never-sent);
 * `invite_required` has to say nothing happened and who can invite. A toast
 * that disappears in four seconds is the wrong host for that, so each renders
 * into a notice that stays until the next submit. Toasts still fire for every
 * success arm, matching the rest of this page.
 */
export function AddTenantMemberForm({ onAdded }: { onAdded: () => void }) {
  const [email, setEmail] = useState("");
  // Developer, not Administrator: the old form defaulted to `admin`, which
  // makes the most privileged grant the one a distracted click produces. A
  // tier is one click to change and a mis-grant is a revoke plus an apology.
  const [role, setRole] = useState<CoordMemberRole>("operator");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<AddMemberOutcome | null>(null);

  const submit = useCallback(async () => {
    const addr = email.trim();
    if (!addr) {
      toast.error("Enter an email address.");
      return;
    }
    setSubmitting(true);
    setOutcome(null);
    try {
      let json: TenantMemberAddResponse;
      try {
        json = await addTenantMember(addr, role);
      } catch (err) {
        const status = httpStatusOf(err);
        // 409 is the resolver's ambiguity verdict (more than one Cognito user
        // carries this email), NOT a generic conflict — same wording the
        // Cognito group member add already uses, because it is the same
        // condition and an operator who has read one should recognise the
        // other.
        if (status === 409) {
          const message =
            "Ambiguous email — more than one Cognito user matches. Resolve in Cognito first.";
          setOutcome({ kind: "error", message });
          toast.error(message);
          return;
        }
        // A 502 can mean the grant landed and only its invitation email
        // failed (`invitation_not_sent`), so the list may have changed.
        if (status === 502) onAdded();
        throw err;
      }
      if (json?.status === "added") {
        const notice = readNotice(json?.notice);
        setOutcome({ kind: "added", email: addr, role, notice });
        // The toast is still a success — the grant worked, which is what the
        // administrator came here to do. `not_sent` is an ACTION for them
        // (tell the colleague themselves), and it is spelled out in the
        // outcome panel below, which does not vanish after four seconds.
        toast.success(`Granted ${tierLabel(role)} access to ${addr}`);
        setEmail("");
        onAdded();
        return;
      }
      if (json?.status === "invited") {
        setOutcome({ kind: "invited", email: addr, role });
        toast.success(`Invited ${addr}`);
        setEmail("");
        onAdded();
        return;
      }
      if (json?.status === "invitation_pending") {
        setOutcome({ kind: "invitation_pending", email: addr, role });
        toast.success(`Granted ${tierLabel(role)} access to ${addr}`);
        setEmail("");
        onAdded();
        return;
      }
      if (json?.status === "invite_required") {
        // Deliberately NOT a success toast and NOT a cleared field: nothing
        // was created, so the administrator's input is still the live thing.
        setOutcome({ kind: "invite_required", email: addr });
        return;
      }
      // A 2xx with no arm this build knows. Rendering it as success would
      // claim access that may not exist; the status is at least true.
      //
      // `status` is coord's, proxied through `post_coord_tenant_member`, so it
      // is body-controlled and faces the same guard as every other value this
      // page shows — a 200 carrying `{"status": "<html>…</html>"}` or 50 KB
      // of it would otherwise render whole into a paragraph AND a toast. A
      // A refused one reads as `unreadable` rather than `missing`: the two are
      // different facts about the body, and an operator grepping coord's logs
      // for a dropped `status` would otherwise be sent after a field that was
      // sent.
      const raw = typeof json?.status === "string" ? json.status : "";
      const reported = raw ? plainSentence(raw) : null;
      throw new Error(
        `Unexpected response from the server (status: ${
          reported ?? (raw ? "unreadable" : "missing")
        }).`
      );
    } catch (err) {
      const message = operationsErrorMessage(err);
      log.warn("add tenant member failed", err);
      setOutcome({ kind: "error", message });
      toast.error(`Add failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [email, role, onAdded]);

  return (
    <div className="space-y-2" data-testid="coord-members-add">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="add-member-email">Add a member by email</Label>
          <Input
            id="add-member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) void submit();
            }}
            placeholder="colleague@example.com"
            data-testid="add-member-email"
          />
        </div>
        <div className="space-y-1 sm:w-52">
          <Label htmlFor="add-member-role">Role</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as CoordMemberRole)}
          >
            <SelectTrigger
              id="add-member-role"
              className="w-full"
              data-testid="add-member-role"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIER_OPTIONS.map((t) => (
                <SelectItem key={t.role} value={t.role}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={submit}
          disabled={submitting}
          data-testid="add-member-submit"
        >
          <UserPlus className="h-4 w-4" />
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>

      {outcome !== null && (
        <div data-testid="add-member-outcome">
          {outcome.kind === "added" ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Granted {tierLabel(outcome.role)} access to {outcome.email}.
              </p>
              {/*
                Whether they were TOLD. The grant is already stated above and
                is true in every branch here, so this sentence only ever adds
                "and here is what to do next" — never a retraction. A `null`
                notice (a backend that predates the field) renders nothing at
                all: silence is the honest rendering of "we do not know", and
                inventing either answer is what this whole notice exists to
                stop.
              */}
              {outcome.notice === "sent" ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  We emailed them to say they now have access.
                </p>
              ) : outcome.notice === "not_sent" ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  We could not email them, so let them know yourself — their
                  access is granted and works now.
                </p>
              ) : outcome.notice === "not_needed" ? (
                /*
                  They already had access to this team, so the grant changed
                  nothing and no email went out. Saying so matters: without
                  it an administrator re-adding a colleague would read the
                  same "Granted …" line as a first-time add and reasonably
                  assume the person had just been told.
                */
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  They already had access, so we did not email them again.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                The list below is by home tenant, so someone whose home tenant
                is a different one may not appear in it. Their access is granted
                either way.
              </p>
            </div>
          ) : outcome.kind === "error" ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {outcome.message}
            </p>
          ) : outcome.kind === "invited" ? (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Mail className="h-4 w-4 shrink-0" />
                Invited {outcome.email} as {tierLabel(outcome.role)}.
              </p>
              <p className="text-xs text-muted-foreground">
                Cognito accepted an invitation email with a temporary password
                for them. They can use their access once they sign in with it,
                using their email and password rather than Google or Microsoft,
                and choose their own password. If the email does not arrive, or
                the temporary password expires, add them again here to send a
                new one.
              </p>
            </div>
          ) : outcome.kind === "invitation_pending" ? (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Granted {tierLabel(outcome.role)} access to {outcome.email}.
              </p>
              <p className="text-xs text-muted-foreground">
                Their Qontinui account has not been activated yet, so they can
                use this access once they sign in for the first time. If they
                have no invitation email, or it has expired, ask a Qontinui
                administrator to add them again, which sends a new one.
              </p>
            </div>
          ) : (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                No Qontinui account exists for {outcome.email} — nothing was
                added, and no email was sent.
              </p>
              <p className="text-xs text-muted-foreground">
                Qontinui is invite-only, so a Qontinui administrator has to
                invite them first. Once their account exists, add them here with
                this same form and the access applies immediately.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
