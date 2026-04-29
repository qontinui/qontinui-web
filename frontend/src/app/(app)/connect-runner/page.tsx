"use client";

/**
 * One-click runner token provisioning landing page.
 *
 * The runner's Settings UI opens this URL with:
 *   ?state=<64-hex>              — random per-flow state, echoed back in redirect
 *   &callback=<runner-url>       — http://127.0.0.1:<port>/auth/runner-token-callback
 *   &runner_name=<hostname>      — shown to the user for confirmation
 *
 * On "Connect" click we POST to /api/v1/runners/tokens, then redirect the
 * browser to `<callback>?state=<state>&token=<plain>&token_id=<id>`. The
 * runner's local callback handler captures the token, persists it, and
 * opens a persistent WebSocket to /api/v1/runners/ws to register with web.
 *
 * Security:
 *   - Token creation requires an explicit button click; no GET-triggered
 *     side effects.
 *   - `callback` must match `^http://127\.0\.0\.1:\d+/auth/runner-token-callback$`.
 *     This blocks an attacker from crafting a link that would redirect the
 *     user's browser (and token!) to an arbitrary URL.
 *   - The `runner_name` is displayed prominently and cannot be forged by a
 *     malicious link without the user noticing.
 *   - The callback URL is shown to the user before redirect.
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2, Server } from "lucide-react";
import { createRunnerToken } from "@/lib/api/runner_tokens";

/** Strict regex: 127.0.0.1 on any port, exactly our callback path. */
const CALLBACK_REGEX =
  /^http:\/\/127\.0\.0\.1:\d+\/auth\/runner-token-callback$/;

function formatYmd(now: Date): string {
  const y = now.getFullYear().toString().padStart(4, "0");
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

export default function ConnectRunnerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const state = searchParams?.get("state") ?? "";
  const callback = searchParams?.get("callback") ?? "";
  const runnerName = searchParams?.get("runner_name") ?? "";

  // Validate inputs. The runner's callback-handler re-checks state on its
  // side, but we validate `callback` here to block open-redirect attacks
  // before we ever POST — if the regex doesn't match, we don't let the
  // user click Connect.
  const validation = useMemo(() => {
    if (!state || state.length < 8 || !/^[0-9a-f]+$/i.test(state)) {
      return {
        ok: false as const,
        error: "Missing or invalid state parameter.",
      };
    }
    if (!callback) {
      return { ok: false as const, error: "Missing callback parameter." };
    }
    if (!CALLBACK_REGEX.test(callback)) {
      return {
        ok: false as const,
        error:
          "Invalid callback URL. Only http://127.0.0.1:<port>/auth/runner-token-callback is allowed.",
      };
    }
    if (!runnerName || runnerName.trim().length === 0) {
      return {
        ok: false as const,
        error: "Missing runner_name parameter.",
      };
    }
    return { ok: true as const };
  }, [state, callback, runnerName]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const handleConnect = async () => {
    if (!validation.ok || submitting) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const safeName = runnerName.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48);
      const tokenName = `browser-flow-${safeName || "runner"}-${formatYmd(new Date())}`;
      const result = await createRunnerToken({
        name: tokenName,
        expires_in_days: null,
      });
      const redirectUrl = new URL(callback);
      redirectUrl.searchParams.set("state", state);
      redirectUrl.searchParams.set("token", result.plain_token);
      redirectUrl.searchParams.set("token_id", result.token_record.id);
      setRedirecting(true);
      // Full navigation (not router.push) — the target is a localhost HTTP
      // server, not part of the Next.js app.
      window.location.href = redirectUrl.toString();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create runner token.";
      setErrorMessage(message);
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    router.push("/runners");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!user) {
    // Send the user to login, preserving the current URL so they come back here.
    const nextPath = `/connect-runner?${searchParams?.toString() ?? ""}`;
    router.push(`/?next=${encodeURIComponent(nextPath)}`);
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-surface-raised to-surface-canvas text-white">
      <main className="max-w-xl mx-auto px-6 py-16">
        <div className="rounded-lg border border-border-subtle bg-surface-raised/80 backdrop-blur-md p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <Server className="w-6 h-6 text-brand-primary" aria-hidden />
            <h1 className="text-2xl font-bold">Connect Runner</h1>
          </div>

          {validation.ok ? (
            <>
              <p className="text-text-muted mb-4">
                You&apos;re about to authorize{" "}
                <strong className="text-white">{runnerName}</strong> to connect
                to your account.
              </p>
              <div className="rounded-md border border-border-subtle bg-surface-canvas/60 p-4 mb-4 space-y-2 text-sm text-text-muted">
                <p>Once authorized, this runner will:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Connect to qontinui-web over a persistent WebSocket</li>
                  <li>
                    Become available to dispatch from the web and mobile apps
                  </li>
                  <li>
                    Stream execution events, terminals, and chat back here
                  </li>
                </ul>
                <p className="pt-2">
                  You can revoke this authorization anytime from{" "}
                  <em>Runners &rarr; Tokens</em>.
                </p>
              </div>

              <div className="rounded-md border border-border-subtle bg-surface-canvas/40 p-3 mb-6 text-xs text-text-muted">
                <div className="font-semibold text-text-default mb-1">
                  Redirect target
                </div>
                <code className="break-all font-mono text-[11px]">
                  {callback}
                </code>
                <p className="mt-2 text-[11px]">
                  This must be a localhost URL your runner is listening on. If
                  it isn&apos;t, don&apos;t click Connect.
                </p>
              </div>

              {errorMessage ? (
                <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 mb-4 text-sm">
                  <AlertTriangle
                    className="w-4 h-4 text-red-400 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <span className="text-red-200">{errorMessage}</span>
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={submitting || redirecting}
                  className="border-border-default"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={submitting || redirecting}
                  className="bg-brand-primary hover:bg-brand-primary/80 text-black"
                >
                  {redirecting ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Redirecting&hellip;
                    </>
                  ) : submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating token&hellip;
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 mb-4 text-sm">
                <AlertTriangle
                  className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
                  aria-hidden
                />
                <span className="text-amber-200">{validation.error}</span>
              </div>
              <p className="text-text-muted text-sm mb-4">
                This page is opened by your runner&apos;s Settings panel when
                you click &ldquo;Connect with web login&rdquo;. If you landed
                here directly, there&apos;s nothing to do.
              </p>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  className="border-border-default"
                >
                  Back to Runners
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
