"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { useAuth } from "@/contexts/auth-context";
import type { User } from "@/types/auth-types";

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
      router.replace(user.is_superuser ? "/admin" : "/dashboard");
    }
  }, [loading, user, next, router]);

  const handleSuccess = (signedIn: User) => {
    if (next && next.startsWith("/")) {
      router.replace(next);
      return;
    }
    if (signedIn?.is_superuser) {
      router.replace("/admin");
    } else {
      router.replace("/dashboard");
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 flex items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Sign in to Qontinui</h1>
          <p className="text-sm text-muted-foreground">
            Save and manage your automation projects.
          </p>
        </div>

        <AuthForm mode="signin" hideTabs onSuccess={handleSuccess} />

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={() => {
              // Reuse the auth dialog from the marketing header by sending
              // the user to the landing page with a hint. The header reads
              // this via state, not URL, so we just route them home — they
              // can click "Sign In" to open the dialog with the Register
              // tab. For now we link to the home page CTA.
              router.push("/");
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
