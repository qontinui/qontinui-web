"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

type Platform = "windows" | "macos" | "linux" | "unknown";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "unknown";
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "macos";
  if (userAgent.includes("linux")) return "linux";
  return "unknown";
}

export function getDownloadLabel(platform: Platform): string {
  switch (platform) {
    case "windows":
      return "Download for Windows";
    case "macos":
      return "Download for macOS";
    case "linux":
      return "Download for Linux";
    default:
      return "Download";
  }
}

export function useLandingPage() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  // `/` stays the public marketing landing for anonymous visitors, but an
  // authenticated user who lands on `/` is forwarded to the authenticated
  // home. That home is the Coord Console (`/admin/coord` → Fleet tab) — the
  // same destination `/login` and `/auth/callback` use, so a returning user
  // with a live session sees the coordination dashboard rather than a
  // different surface depending on how they arrived. The co-pilot surface
  // stays available at `/prompt-home` via the sidebar.
  useEffect(() => {
    if (user) {
      router.replace("/admin/coord");
    }
  }, [user, router]);

  const handleDownload = () => {
    if (platform === "windows") {
      // Version-free redirect — resolves to the MSI in the latest release.
      window.location.href =
        "/api/v1/releases/runner/download?platform=windows&kind=msi";
    } else {
      router.push("/runner/download");
    }
  };

  const openSignIn = () => {
    setAuthDialogOpen(true);
  };

  return {
    authDialogOpen,
    setAuthDialogOpen,
    platform,
    user,
    router,
    handleDownload,
    openSignIn,
  };
}
