"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { useAuth } from "@/contexts/auth-context";

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
      // Coord-centric product: the Coord Console is the post-login home.
      // (`/admin/coord` redirects to its Fleet tab.) The console is meant to
      // be viewable by any authenticated user; per-control mutations stay
      // coord-RBAC gated server-side.
      router.replace("/admin/coord");
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

        {/*
          Qontinui is invite-only during the beta — self-service registration
          is intentionally disabled on the Cognito user pool (the hosted-UI
          `/signup` endpoint errors out). Rather than route new users into that
          dead end, point them at a real "request access" channel.
        */}
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account? Qontinui is currently invite-only.{" "}
          <a
            href="mailto:support@qontinui.io?subject=Qontinui%20access%20request"
            className="text-primary underline-offset-4 hover:underline"
          >
            Request access
          </a>
        </p>
      </div>
    </div>
  );
}
