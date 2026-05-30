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

  const handleDownload = () => {
    if (platform === "windows") {
      window.location.href =
        "https://github.com/qontinui/qontinui-runner/releases/tag/v1.0.0-beta.1";
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
