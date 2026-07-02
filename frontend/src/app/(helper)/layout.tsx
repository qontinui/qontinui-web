"use client";

/**
 * Minimal layout for the helper portal route group.
 *
 * Deliberately NOT the (app) shell: no sidebar, no tab state, no automation
 * providers — a locked-down, distraction-free surface for non-technical
 * helpers (helper-task-queue plan Phase 1.4). Only an auth gate: the portal
 * requires a signed-in user (the backend proxy needs their bearer), but any
 * authenticated user may visit — owners test the queue here too.
 */

import { Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function HelperAuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading || user) return;
    const query = searchParams?.toString();
    const next = query ? `${pathname}?${query}` : pathname;
    router.replace(`/login?next=${encodeURIComponent(next ?? "/help")}`);
  }, [loading, user, pathname, searchParams, router]);

  if (loading || !user) {
    return <LoadingShell />;
  }
  return <>{children}</>;
}

export default function HelperLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <HelperAuthGate>{children}</HelperAuthGate>
    </Suspense>
  );
}
