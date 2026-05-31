"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  consumePkceState,
  exchangeCodeForTokens,
  verifyStateAndExtractNext,
} from "@/services/auth/cognito-oauth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AuthCallback");

export const dynamic = "force-dynamic";

/**
 * Cognito hosted-UI callback. Completes the Authorization Code + PKCE exchange
 * for any federated provider (Google / Microsoft / GitHub — they all land here
 * identically), establishes the session, and redirects to the post-login
 * destination. Provider-agnostic: nothing here branches on the IdP.
 */
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { completeExternalLogin } = useAuth();
  const [status, setStatus] = useState<"exchanging" | "success" | "error">(
    "exchanging"
  );
  const [errorMessage, setErrorMessage] = useState("");
  // The OAuth `code` is single-use; React 18 StrictMode double-invokes effects
  // in dev, so guard against a second exchange that would 400.
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const code = searchParams.get("code");
    const returnedState = searchParams.get("state");
    const oauthError = searchParams.get("error");
    const oauthErrorDescription = searchParams.get("error_description");

    const run = async () => {
      // The hosted UI can redirect back with an error (e.g. user cancelled or
      // an IdP-side failure) instead of a code.
      if (oauthError) {
        setStatus("error");
        setErrorMessage(
          oauthErrorDescription || `Sign-in was not completed (${oauthError}).`
        );
        return;
      }

      if (!code) {
        // No `code` and no `error` — this isn't a real OAuth return but a
        // bare/direct navigation to /auth/callback (e.g. a person typing the
        // URL, or a crawler). Not an error state; quietly send them to /login.
        router.replace("/login");
        return;
      }

      try {
        // CSRF / replay guard + recover the optional post-login destination.
        const next = verifyStateAndExtractNext(returnedState);

        const tokens = await exchangeCodeForTokens(code);

        // Send the ID token, NOT the access token, as the bearer. Only the
        // Cognito ID token carries the identity claims (`email`, `name`, `sub`)
        // the backend provisions the user from; the access token has none, so
        // a federated (e.g. Google) sign-in would provision an email-less user
        // and 500 on /users/me. The backend's verifier dual-accepts ID tokens
        // (aud == client_id). See cognito_provision._extract_email.
        await completeExternalLogin({
          access_token: tokens.id_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
        });

        // Single-use PKCE values are done — clear them.
        consumePkceState();

        setStatus("success");

        const dest = next && next.startsWith("/") ? next : "/dashboard";
        router.replace(dest);
      } catch (error: unknown) {
        consumePkceState();
        logger.error("Cognito callback failed:", error);
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Sign-in could not be completed. Please try again."
        );
      }
    };

    void run();
    // searchParams / router / completeExternalLogin are stable for the life of
    // this mount; the hasRun guard makes a single execution explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="p-8">
          <div className="text-center space-y-6">
            {status === "exchanging" && (
              <>
                <div className="flex justify-center">
                  <Loader2 className="h-16 w-16 text-primary animate-spin" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Signing you in</h2>
                  <p className="text-muted-foreground">
                    Completing sign-in, just a moment...
                  </p>
                </div>
              </>
            )}

            {status === "success" && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-green-100 dark:bg-green-900/20 p-4">
                    <CheckCircle2 className="h-16 w-16 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Signed in!</h2>
                  <p className="text-muted-foreground">Redirecting...</p>
                </div>
              </>
            )}

            {status === "error" && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4">
                    <XCircle className="h-16 w-16 text-red-600 dark:text-red-400" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Sign-in failed</h2>
                  <p className="text-muted-foreground mb-4">{errorMessage}</p>
                </div>
                <Button asChild className="w-full">
                  <Link href="/login">Back to sign in</Link>
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackContent />
    </Suspense>
  );
}
