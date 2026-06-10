"use client";

/**
 * Connected accounts — cross-IdP identity linking.
 *
 * Lists the federated identities attached to the caller's canonical Cognito
 * account, lets them connect additional providers (Google / Microsoft /
 * GitHub) via a LINK-MODE OAuth round-trip, and unlink non-native ones.
 *
 * UX priorities applied:
 *  - Honesty: verification state is shown exactly as the backend reports it
 *    (verified / unverified / unknown) — never an implied "all good" badge.
 *  - Predictability: the connect button copy states precisely what it does
 *    (sign in to THIS account with that provider).
 *  - No-surprise reversibility: unlink asks for confirmation, and the 409
 *    lockout reason (can't remove the last/native identity) is surfaced
 *    verbatim instead of a generic failure.
 *
 * The actual link happens out-of-band: `startCognitoLink` redirects to the
 * Cognito hosted UI, the callback POSTs the federated id_token to the link
 * endpoint using the canonical session, then redirects back here with a
 * `?connect=success|error` marker that this component turns into a toast.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  Github,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  ShieldQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIdentities, unlinkKey } from "@/hooks/useIdentities";
import {
  NATIVE_PROVIDER,
  UnlinkIdentityError,
  type LinkedIdentity,
} from "@/lib/api/identities";
import {
  startCognitoLink,
  type CognitoProvider,
} from "@/services/auth/cognito-oauth";

/** The federated providers the user can connect, with display metadata. */
const CONNECTABLE_PROVIDERS: ReadonlyArray<{
  /** The exact Cognito `identity_provider` value. */
  provider: CognitoProvider;
  /** Human-facing name. */
  label: string;
  /** Provider names the backend may report for this IdP (case-insensitive). */
  aliases: string[];
}> = [
  { provider: "Google", label: "Google", aliases: ["google"] },
  {
    provider: "MicrosoftEntra",
    label: "Microsoft",
    aliases: ["microsoftentra", "microsoft", "azuread"],
  },
  { provider: "GitHub", label: "GitHub", aliases: ["github"] },
];

/** Pick an icon for a provider name. */
function providerIcon(provider: string): React.ReactNode {
  const p = provider.toLowerCase();
  if (p === "cognito") return <KeyRound className="size-4" />;
  if (p === "github") return <Github className="size-4" />;
  // Google / Microsoft / others — a generic mail glyph keeps it honest
  // without shipping unverified third-party brand marks.
  return <Mail className="size-4" />;
}

/** Friendly display name for a reported provider. */
function providerDisplayName(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "cognito") return "Email & password";
  const known = CONNECTABLE_PROVIDERS.find((c) =>
    c.aliases.includes(p)
  );
  return known?.label ?? provider;
}

function isNative(identity: LinkedIdentity): boolean {
  return identity.provider === NATIVE_PROVIDER;
}

export function ConnectedAccounts() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isLoading, error, refetch, unlink, unlinkingKey } =
    useIdentities();

  // Provider whose link-mode OAuth redirect is being kicked off (the page is
  // about to navigate away, so this is mostly to disable the button briefly).
  const [connecting, setConnecting] = useState<CognitoProvider | null>(null);
  // The identity pending unlink confirmation, or null when the dialog is shut.
  const [pendingUnlink, setPendingUnlink] = useState<LinkedIdentity | null>(
    null
  );

  // Turn the `?connect=success|error` marker the callback redirects back with
  // into a toast, then strip it from the URL and refetch the list.
  useEffect(() => {
    const connect = searchParams.get("connect");
    if (!connect) return;

    if (connect === "success") {
      toast.success("Account connected", {
        description: "You can now sign in to this account with it.",
      });
      refetch();
    } else if (connect === "error") {
      const reason = searchParams.get("reason");
      toast.error("Could not connect the account", {
        description: reason || "Please try again.",
      });
    }
    // Strip the query params so a refresh doesn't re-toast.
    router.replace("/settings/account");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const identities = data?.identities ?? [];
  const linkedProviderNames = new Set(
    identities.map((i) => i.provider.toLowerCase())
  );
  // How many identities each provider has. >1 means a disambiguating per-row
  // hint is shown (two real Google accounts, or one account double-linked by
  // oid+sub) so the rows aren't indistinguishable — and unlink targets the
  // exact identity rather than the first provider match.
  const providerCounts = identities.reduce<Record<string, number>>((acc, i) => {
    const p = i.provider.toLowerCase();
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});
  // Providers offered for connect = connectable set minus any already linked.
  const availableToConnect = CONNECTABLE_PROVIDERS.filter(
    (c) => !c.aliases.some((alias) => linkedProviderNames.has(alias))
  );

  const handleConnect = async (provider: CognitoProvider) => {
    setConnecting(provider);
    try {
      // Full-page redirect to the Cognito hosted UI — does not return.
      await startCognitoLink(provider);
    } catch (e) {
      setConnecting(null);
      toast.error("Could not start connecting", {
        description:
          e instanceof Error ? e.message : "Please try again.",
      });
    }
  };

  const confirmUnlink = async () => {
    const target = pendingUnlink;
    setPendingUnlink(null);
    if (!target) return;
    try {
      await unlink(target.provider, target.user_id ?? undefined);
      toast.success("Account disconnected", {
        description: `${providerDisplayName(
          target.provider
        )} can no longer sign in to this account.`,
      });
    } catch (e) {
      if (e instanceof UnlinkIdentityError && e.isLockout) {
        // No-surprise reversibility: explain WHY it was refused.
        toast.error("Cannot disconnect this account", {
          description: e.message,
        });
      } else {
        toast.error("Could not disconnect the account", {
          description: e instanceof Error ? e.message : "Please try again.",
        });
      }
    }
  };

  return (
    <div
      className="rounded-lg border border-border"
      data-content-role="section"
      data-content-label="connected accounts"
    >
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Link2 className="size-4" />
          Connected accounts
        </h3>
        <p className="text-xs text-muted-foreground">
          Sign-in methods linked to this account. Connecting a provider lets you
          sign in to <span className="font-medium">this same account</span> with
          it.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Load / error states */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="size-4 animate-spin" />
            Loading connected accounts...
          </div>
        ) : error ? (
          <div
            className="flex items-start gap-2 text-sm text-destructive"
            data-content-role="status"
            data-content-label="connected accounts error"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>
              Could not load connected accounts. {error.message}
              <button
                type="button"
                onClick={() => refetch()}
                className="ml-2 underline hover:no-underline"
              >
                Retry
              </button>
            </span>
          </div>
        ) : (
          <>
            {/* Linked identities */}
            <ul className="space-y-2" data-content-label="linked identities">
              {identities.map((identity) => (
                <li
                  key={`${identity.provider}:${identity.user_id ?? "native"}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                  data-content-role="list-item"
                  data-content-label={`identity ${identity.provider}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-muted-foreground shrink-0">
                      {providerIcon(identity.provider)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">
                          {providerDisplayName(identity.provider)}
                        </span>
                        {isNative(identity) && (
                          <Badge variant="secondary">Native</Badge>
                        )}
                        <VerificationBadge identity={identity} />
                      </div>
                      {identity.email && (
                        <p className="text-xs text-muted-foreground truncate">
                          {identity.email}
                        </p>
                      )}
                      {/* Disambiguate when a provider has multiple identities
                          (the canonical email above is identical across them, so
                          it can't tell them apart). The id tail makes the rows
                          distinct and matches what the unlink confirmation
                          references. */}
                      {!isNative(identity) &&
                        (providerCounts[identity.provider.toLowerCase()] ?? 0) >
                          1 &&
                        identity.user_id && (
                          <p className="text-[10px] font-mono text-muted-foreground/70 truncate">
                            id ····{identity.user_id.slice(-8)}
                          </p>
                        )}
                    </div>
                  </div>

                  {/* Only non-native identities can be unlinked. */}
                  {!isNative(identity) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        unlinkingKey ===
                        unlinkKey(identity.provider, identity.user_id)
                      }
                      onClick={() => setPendingUnlink(identity)}
                      data-content-label={`unlink ${identity.provider}`}
                    >
                      {unlinkingKey ===
                      unlinkKey(identity.provider, identity.user_id) ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          Disconnecting...
                        </>
                      ) : (
                        "Unlink"
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {/* Connect more providers */}
            {availableToConnect.length > 0 && (
              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs text-muted-foreground">
                  Connect another sign-in method
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableToConnect.map(({ provider, label }) => (
                    <Button
                      key={provider}
                      variant="outline"
                      size="sm"
                      disabled={connecting !== null}
                      onClick={() => handleConnect(provider)}
                      title={`Connect a ${label} account so you can sign in to this account with it`}
                      data-content-label={`connect ${provider}`}
                    >
                      {connecting === provider ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        providerIcon(provider)
                      )}
                      Connect {label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Unlink confirmation — no-surprise reversibility */}
      <AlertDialog
        open={pendingUnlink !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUnlink(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect{" "}
              {pendingUnlink
                ? providerDisplayName(pendingUnlink.provider)
                : "this account"}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You will no longer be able to sign in to this account with{" "}
              {pendingUnlink
                ? providerDisplayName(pendingUnlink.provider)
                : "this provider"}
              {pendingUnlink?.user_id &&
              (providerCounts[pendingUnlink.provider.toLowerCase()] ?? 0) >
                1 ? (
                <>
                  {" "}
                  identity{" "}
                  <span className="font-mono">
                    ····{pendingUnlink.user_id.slice(-8)}
                  </span>{" "}
                  (only this one — your other {" "}
                  {providerDisplayName(pendingUnlink.provider)} sign-in stays
                  linked)
                </>
              ) : null}
              . You can reconnect it again at any time. Your other sign-in
              methods are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlink}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Email-verification badge. Honest about uncertainty: shows "Verified" only
 * when the backend says `email_verified === true`, "Unverified" when it says
 * `false`, and "Verification unknown" when it doesn't report (`null`). Never
 * implies verification that isn't there.
 */
function VerificationBadge({ identity }: { identity: LinkedIdentity }) {
  if (!identity.email) return null;
  if (identity.email_verified === true) {
    return (
      <Badge variant="success">
        <BadgeCheck className="size-3" />
        Verified
      </Badge>
    );
  }
  if (identity.email_verified === false) {
    return (
      <Badge variant="warning">
        <AlertTriangle className="size-3" />
        Unverified
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <ShieldQuestion className="size-3" />
      Verification unknown
    </Badge>
  );
}
