"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Download,
  CheckCircle2,
  Github,
  AlertCircle,
  Apple,
  MonitorSmartphone,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Platform = "windows" | "macos" | "linux" | "unknown";

interface ReleaseInfo {
  version: string;
  date: string;
  github_url: string;
}

// Latest release info - update this when releasing
const LATEST_RELEASE: ReleaseInfo = {
  version: "1.0.0-beta.1",
  date: "2026",
  github_url:
    "https://github.com/qontinui/qontinui-runner/releases/tag/v1.0.0-beta.1",
};

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "unknown";

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "macos";
  if (userAgent.includes("linux")) return "linux";

  return "unknown";
}

function getPlatformIcon(platform: Platform) {
  switch (platform) {
    case "windows":
      return <MonitorSmartphone className="h-6 w-6" />;
    case "macos":
      return <Apple className="h-6 w-6" />;
    case "linux":
      return <MonitorSmartphone className="h-6 w-6" />;
    default:
      return <Download className="h-6 w-6" />;
  }
}

function getPlatformName(platform: Platform): string {
  switch (platform) {
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return "Unknown";
  }
}

const emptySubscribe = () => () => {};

export default function DownloadPage() {
  const platform = useSyncExternalStore(
    emptySubscribe,
    detectPlatform,
    () => "unknown" as Platform
  );
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (
    selectedPlatform: Platform,
    filename: string
  ) => {
    setDownloading(filename);

    // Collect client-side analytics data (privacy-friendly, no PII)
    const getUtmParams = () => {
      if (typeof window === "undefined") return {};
      const params = new URLSearchParams(window.location.search);
      return {
        utm_source: params.get("utm_source") || undefined,
        utm_medium: params.get("utm_medium") || undefined,
        utm_campaign: params.get("utm_campaign") || undefined,
      };
    };

    const getScreenResolution = () => {
      if (typeof window === "undefined") return undefined;
      return `${window.screen.width}x${window.screen.height}`;
    };

    const getTimezone = () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    };

    // Track download (privacy-friendly, anonymized on server)
    try {
      await fetch("/api/analytics/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: selectedPlatform,
          version: LATEST_RELEASE.version,
          timestamp: new Date().toISOString(),
          // Client-side data
          timezone: getTimezone(),
          screen_resolution: getScreenResolution(),
          referrer: document.referrer || undefined,
          ...getUtmParams(),
        }),
      });
    } catch (e) {
      // Silent fail - don&apos;t block download
      console.error("Analytics error:", e);
    }

    // Redirect to GitHub release download
    const downloadUrl = `${LATEST_RELEASE.github_url.replace("/tag/", "/download/")}/${filename}`;
    window.location.href = downloadUrl;

    // Reset downloading state after a delay
    setTimeout(() => setDownloading(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted to-background">
      {/* Header */}
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Download Qontinui Runner
          </h1>
          <p className="text-lg text-muted-foreground mb-2">
            Latest version:{" "}
            <span className="font-semibold">{LATEST_RELEASE.version}</span>{" "}
            (Beta)
          </p>
          <p className="text-sm text-muted-foreground">
            Released {LATEST_RELEASE.date}
          </p>
        </div>
      </section>

      {/* Detected Platform Callout */}
      {platform !== "unknown" && (
        <section className="container mx-auto px-4 pb-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                {getPlatformIcon(platform)}
                <h2 className="text-xl font-semibold text-foreground">
                  Detected Platform: {getPlatformName(platform)}
                </h2>
              </div>
              <p className="text-muted-foreground mb-4">
                We&apos;ve detected you&apos;re using{" "}
                {getPlatformName(platform)}. Download the recommended version
                below.
              </p>
              {platform === "windows" && (
                <Button
                  size="lg"
                  disabled={
                    downloading === "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi"
                  }
                  onClick={() =>
                    handleDownload(
                      "windows",
                      "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi"
                    )
                  }
                  className="bg-primary hover:bg-primary/90"
                >
                  {downloading ===
                  "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi" ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Starting Download...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-5 w-5" />
                      Download for Windows (MSI)
                    </>
                  )}
                </Button>
              )}
              {platform === "macos" && (
                <div className="text-center">
                  <p className="text-muted-foreground mb-3 font-medium">
                    macOS builds coming soon!
                  </p>
                  <a
                    href="https://github.com/qontinui/qontinui-runner#macos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-muted-foreground hover:bg-muted-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
                  >
                    <Github className="w-4 h-4" />
                    Build from source
                  </a>
                </div>
              )}
              {platform === "linux" && (
                <div className="text-center">
                  <p className="text-muted-foreground mb-3 font-medium">
                    Linux builds coming soon!
                  </p>
                  <a
                    href="https://github.com/qontinui/qontinui-runner#linux"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-muted-foreground hover:bg-muted-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
                  >
                    <Github className="w-4 h-4" />
                    Build from source
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Installation Warning (for unsigned builds) */}
      <section className="container mx-auto px-4 pb-8">
        <div className="max-w-4xl mx-auto">
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-500/30">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            <AlertDescription className="text-muted-foreground">
              <strong>First time installation:</strong> You may see security
              warnings because the app is not yet code-signed. We&apos;re
              working on this!{" "}
              <Link
                href="/docs/runner/installation"
                className="underline text-primary hover:text-primary/80"
              >
                See installation guide →
              </Link>
            </AlertDescription>
          </Alert>
        </div>
      </section>

      {/* Downloads */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Windows */}
          <DownloadSection
            platform="Windows"
            icon="🪟"
            currentPlatform={platform}
            downloads={[
              {
                name: "Windows Installer (MSI)",
                file: "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi",
                size: "~6 MB",
                type: "MSI Package",
                signed: false, // Update to true when signed
                description:
                  "Recommended - Standard Windows installer (Windows 10 or later)",
                onDownload: () =>
                  handleDownload(
                    "windows",
                    "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi"
                  ),
                downloading:
                  downloading === "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi",
              },
              {
                name: "Windows Installer (EXE)",
                file: "Qontinui.Runner_1.0.0-beta.1_x64-setup.exe",
                size: "~4 MB",
                type: "NSIS Installer",
                signed: false,
                description: "Alternative installer for Windows 10 or later",
                onDownload: () =>
                  handleDownload(
                    "windows",
                    "Qontinui.Runner_1.0.0-beta.1_x64-setup.exe"
                  ),
                downloading:
                  downloading === "Qontinui.Runner_1.0.0-beta.1_x64-setup.exe",
              },
            ]}
          />

          {/* macOS */}
          <div className="bg-card rounded-lg border border-border overflow-hidden opacity-60">
            <div className="bg-muted px-6 py-4 border-b border-border">
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                <span className="text-3xl">🍎</span>
                macOS
                <span className="text-sm font-normal bg-amber-500 text-white px-2 py-1 rounded">
                  Coming Soon
                </span>
              </h2>
            </div>
            <div className="p-6">
              <p className="text-muted-foreground mb-4">
                Pre-built macOS binaries are not yet available. For now, please
                build from source.
              </p>
              <a
                href="https://github.com/qontinui/qontinui-runner#macos"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-muted-foreground hover:bg-muted-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                <Github className="w-4 h-4" />
                Build Instructions
              </a>
            </div>
          </div>

          {/* Linux */}
          <div className="bg-card rounded-lg border border-border overflow-hidden opacity-60">
            <div className="bg-muted px-6 py-4 border-b border-border">
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                <span className="text-3xl">🐧</span>
                Linux
                <span className="text-sm font-normal bg-amber-500 text-white px-2 py-1 rounded">
                  Coming Soon
                </span>
              </h2>
            </div>
            <div className="p-6">
              <p className="text-muted-foreground mb-4">
                Pre-built Linux binaries are not yet available. For now, please
                build from source.
              </p>
              <a
                href="https://github.com/qontinui/qontinui-runner#linux"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-muted-foreground hover:bg-muted-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                <Github className="w-4 h-4" />
                Build Instructions
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* GitHub Releases */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <Github className="w-6 h-6 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-foreground">
                GitHub Releases
              </h2>
            </div>
            <p className="text-muted-foreground mb-4">
              All releases are available on GitHub with checksums and release
              notes.
            </p>
            <a
              href={LATEST_RELEASE.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-foreground hover:bg-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              <Github className="w-4 h-4" />
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Installation Instructions */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-8 text-foreground">
            Installation Instructions
          </h2>

          <div className="space-y-6">
            <InstallInstructions
              platform="Windows"
              steps={[
                "Download the .msi installer",
                "Run the installer",
                "Windows SmartScreen warning will appear (app not yet signed)",
                "Click 'More info' → 'Run anyway'",
                "Follow the installation wizard",
                "Launch Qontinui Runner from the Start Menu",
              ]}
            />

            <div className="bg-muted p-6 rounded-lg border border-border">
              <h3 className="text-lg font-semibold mb-4 text-foreground">
                macOS & Linux
              </h3>
              <p className="text-muted-foreground mb-3">
                Pre-built binaries for macOS and Linux are coming soon. For now,
                please build from source:
              </p>
              <a
                href="https://github.com/qontinui/qontinui-runner#installation"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-semibold underline"
              >
                <Github className="w-4 h-4" />
                View build instructions on GitHub →
              </a>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/docs/runner/installation"
              className="text-primary hover:text-primary/80 font-semibold underline"
            >
              → Detailed Installation Guide with Screenshots
            </Link>
          </div>
        </div>
      </section>

      {/* System Requirements */}
      <section className="bg-muted py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-8 text-foreground">
              System Requirements
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <RequirementCard
                platform="Windows"
                requirements={[
                  "Windows 10 or later",
                  "64-bit processor",
                  "4 GB RAM (8 GB recommended)",
                  "200 MB disk space",
                ]}
              />
              <RequirementCard
                platform="macOS"
                requirements={[
                  "macOS 11 (Big Sur) or later",
                  "Apple Silicon or Intel",
                  "4 GB RAM (8 GB recommended)",
                  "200 MB disk space",
                ]}
              />
              <RequirementCard
                platform="Linux"
                requirements={[
                  "Modern Linux distribution",
                  "64-bit processor",
                  "4 GB RAM (8 GB recommended)",
                  "200 MB disk space",
                  "X11 or Wayland display server",
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Support */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4 text-foreground">
            Need Help?
          </h2>
          <p className="text-muted-foreground mb-6">
            Check out our documentation or report issues on GitHub
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/docs/runner"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-lg font-semibold transition-colors"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/qontinui/qontinui-runner/issues"
              className="bg-muted hover:bg-muted/80 text-foreground px-6 py-2 rounded-lg font-semibold transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an Issue
            </a>
            <Link
              href="/docs/getting-started"
              className="bg-muted hover:bg-muted/80 text-foreground px-6 py-2 rounded-lg font-semibold transition-colors"
            >
              Getting Started
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function DownloadSection({
  platform,
  icon,
  currentPlatform,
  downloads,
}: {
  platform: string;
  icon: string;
  currentPlatform: Platform;
  downloads: Array<{
    name: string;
    file: string;
    size: string;
    type: string;
    signed: boolean;
    description: string;
    onDownload: () => void;
    downloading: boolean;
  }>;
}) {
  const isCurrentPlatform = platform.toLowerCase() === currentPlatform;

  return (
    <div
      className={`bg-card rounded-lg border ${isCurrentPlatform ? "border-primary shadow-lg" : "border-border"} overflow-hidden`}
    >
      <div
        className={`${isCurrentPlatform ? "bg-primary/10" : "bg-muted"} px-6 py-4 border-b border-border`}
      >
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          {platform}
          {isCurrentPlatform && (
            <span className="text-sm font-normal bg-primary text-primary-foreground px-2 py-1 rounded">
              Your Platform
            </span>
          )}
        </h2>
      </div>
      <div className="p-6 space-y-4">
        {downloads.map((download, idx) => (
          <div
            key={idx}
            className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border hover:border-primary/50 transition-colors"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-foreground">
                  {download.name}
                </h3>
                {download.signed && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-success/20 text-brand-success text-xs rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Signed
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {download.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {download.type} • {download.size}
              </p>
            </div>
            <Button
              disabled={download.downloading}
              onClick={download.onDownload}
              className="flex-shrink-0 bg-primary hover:bg-primary/90"
            >
              {download.downloading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InstallInstructions({
  platform,
  steps,
}: {
  platform: string;
  steps: string[];
}) {
  return (
    <div className="bg-card p-6 rounded-lg border border-border">
      <h3 className="text-lg font-semibold mb-4 text-foreground">{platform}</h3>
      <ol className="space-y-2">
        {steps.map((step, idx) => (
          <li key={idx} className="flex gap-3 text-muted-foreground">
            <span className="font-semibold text-primary flex-shrink-0">
              {idx + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RequirementCard({
  platform,
  requirements,
}: {
  platform: string;
  requirements: string[];
}) {
  return (
    <div className="bg-card p-6 rounded-lg border border-border">
      <h3 className="font-semibold mb-4 text-foreground">{platform}</h3>
      <ul className="space-y-2">
        {requirements.map((req, idx) => (
          <li key={idx} className="flex gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-brand-success flex-shrink-0 mt-0.5" />
            <span>{req}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
