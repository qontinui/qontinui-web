"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { useAuth } from "@/contexts/auth-context";
import { startCognitoSignup } from "@/services/auth/cognito-oauth";
import { toast } from "sonner";

export const dynamic = "force-dynamic";

/**
 * Standalone `/login` route. Mirrors the auth dialog's behaviour but is
 * navigable, deep-linkable, and the canonical destination for middleware
 * redirects on protected routes.
 */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  const next = searchParams?.get("next") || "";

  // If already authenticated, skip the form.
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (next && next.startsWith("/")) {
      router.replace(next);
    } else {
      // Land on the general, mode-aware home. `/dashboard` forwards to
      // `/build/workflows` (AI Dev) or `/tools/visual-automation` (Visual)
      // based on the stored product mode. Superusers are NOT sent to the
      // admin-only area on login — Admin is an opt-in sidebar destination.
      router.replace("/dashboard");
    }
  }, [loading, user, next, router]);

  return (
    <div className="container mx-auto px-4 py-16 flex items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Sign in to Qontinui</h1>
          <p className="text-sm text-muted-foreground">
            Save and manage your automation projects.
          </p>
        </div>

        <AuthForm next={next && next.startsWith("/") ? next : undefined} />

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={async () => {
              // Send new users straight to the Cognito hosted-UI registration
              // screen so they can create an account. Same PKCE/`/auth/callback`
              // round-trip as sign-in, carrying the post-signup `next` path.
              try {
                await startCognitoSignup(
                  next && next.startsWith("/") ? next : undefined
                );
              } catch (error: unknown) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not start sign-up. Please try again."
                );
              }
            }}
            className="text-primary underline-offset-4 hover:underline"
          >
            Get started
          </button>
        </p>
      </div>
    </div>
  );
}
