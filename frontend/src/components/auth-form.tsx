"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  startCognitoLogin,
  type CognitoProvider,
} from "@/services/auth/cognito-oauth";

export interface AuthFormProps {
  /**
   * Same-origin post-login destination, carried through the Cognito OAuth
   * `state` so the `/auth/callback` route can land the user where they were
   * headed. Ignored if it isn't an absolute same-origin path.
   */
  next?: string;
}

/**
 * Sign-in / sign-up entry point. Shared by the marketing-header AuthDialog and
 * the standalone `/login` route.
 *
 * Every authentication path is Cognito. "Continue with email" routes to the
 * Cognito hosted UI with no `identity_provider`, so Cognito presents its native
 * email/password screen (which also offers sign-up + password reset). The
 * social buttons jump straight to the corresponding federated IdP. There is no
 * local password form — the app never sees the user's password.
 */
export function AuthForm({ next }: AuthFormProps) {
  // Which redirect is in flight (disables all buttons + shows which one is
  // navigating away). `"email"` is the native hosted-UI screen (no provider).
  // Cleared only if the pre-redirect navigation fails.
  const [pending, setPending] = useState<CognitoProvider | "email" | null>(
    null
  );

  const nextPath = next && next.startsWith("/") ? next : undefined;

  const beginLogin = async (provider?: CognitoProvider) => {
    setPending(provider ?? "email");
    try {
      // Navigates the browser to the Cognito hosted UI; control does not return
      // here on success. Any thrown error is a pre-redirect failure (e.g.
      // crypto unavailable), so re-enable the buttons.
      await startCognitoLogin(provider, nextPath);
    } catch (error: unknown) {
      setPending(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start sign-in. Please try again."
      );
    }
  };

  const busy = pending !== null;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => beginLogin("Google")}
        >
          <GoogleIcon className="mr-2 h-4 w-4" />
          {pending === "Google"
            ? "Redirecting to Google..."
            : "Continue with Google"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => beginLogin("MicrosoftEntra")}
        >
          <MicrosoftIcon className="mr-2 h-4 w-4" />
          {pending === "MicrosoftEntra"
            ? "Redirecting to Microsoft..."
            : "Continue with Microsoft"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => beginLogin("GitHub")}
        >
          <GitHubIcon className="mr-2 h-4 w-4" />
          {pending === "GitHub"
            ? "Redirecting to GitHub..."
            : "Continue with GitHub"}
        </Button>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or</span>
        </div>
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={busy}
        onClick={() => beginLogin()}
      >
        {pending === "email" ? "Redirecting..." : "Continue with email"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Email sign-in, sign-up, and password reset are handled securely by
        Qontinui&apos;s hosted login.
      </p>
    </div>
  );
}

/** Google "G" brand mark (multi-color), used on the social sign-in button. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/** Microsoft four-square brand mark, used on the social sign-in button. */
function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

/** GitHub octocat brand mark, used on the social sign-in button. */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
