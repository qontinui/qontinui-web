"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
type AssetKind = "msi" | "exe" | "dmg" | "appimage" | "deb";
type Arch = "x64" | "arm64" | "unknown";

interface ReleaseAsset {
  name: string;
  url: string;
  size: number | null;
  content_type: string | null;
  platform: Exclude<Platform, "unknown">;
  kind: AssetKind;
  arch: Arch;
}

interface LatestRelease {
  version: string;
  tag: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

// Resolved dynamically against the latest GitHub release. The version is never
// hardcoded — the backend endpoint reads the GitHub Releases API and the
// download buttons point at a version-free redirect.
const LATEST_ENDPOINT = "/api/v1/releases/runner/latest";
const DOWNLOAD_ENDPOINT = "/api/v1/releases/runner/download";
const RELEASES_PAGE = "https://github.com/qontinui/qontinui-runner/releases";

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

function assetLabel(asset: ReleaseAsset): string {
  const archSuffix =
    asset.arch === "arm64"
      ? " (Apple Silicon)"
      : asset.arch === "x64" && asset.platform === "macos"
        ? " (Intel)"
        : "";
  switch (asset.kind) {
    case "msi":
      return "Windows Installer (MSI)";
    case "exe":
      return "Windows Installer (EXE)";
    case "dmg":
      return `macOS Disk Image${archSuffix}`;
    case "appimage":
      return "Linux AppImage";
    case "deb":
      return "Linux .deb Package";
    default:
      return asset.name;
  }
}

function assetTypeLabel(kind: AssetKind): string {
  switch (kind) {
    case "msi":
      return "MSI Package";
    case "exe":
      return "NSIS Installer";
    case "dmg":
      return "Disk Image";
    case "appimage":
      return "AppImage";
    case "deb":
      return "Debian Package";
    default:
      return kind;
  }
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `~${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

const BUILD_FROM_SOURCE: Record<string, string> = {
  macos: "https://github.com/qontinui/qontinui-runner#macos",
  linux: "https://github.com/qontinui/qontinui-runner#linux",
};

const emptySubscribe = () => () => {};

export default function DownloadPage() {
  const platform = useSyncExternalStore(
    emptySubscribe,
    detectPlatform,
    () => "unknown" as Platform
  );
  const [downloading, setDownloading] = useState<string | null>(null);
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(LATEST_ENDPOINT)
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data: LatestRelease) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const assetsByPlatform = useMemo(() => {
    const grouped: Record<Exclude<Platform, "unknown">, ReleaseAsset[]> = {
      windows: [],
      macos: [],
      linux: [],
    };
    for (const asset of release?.assets ?? []) {
      grouped[asset.platform].push(asset);
    }
    return grouped;
  }, [release]);

  const handleDownload = async (asset: ReleaseAsset) => {
    const key = `${asset.platform}-${asset.kind}-${asset.arch}`;
    setDownloading(key);

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
      await fetch("/api/v1/analytics/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: asset.platform,
          version: release?.version,
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

    // Hand off to the version-free redirect endpoint, which 302s to the
    // matching asset in the latest release.
    const params = new URLSearchParams({ platform: asset.platform });
    params.set("kind", asset.kind);
    if (asset.arch !== "unknown") params.set("arch", asset.arch);
    window.location.href = `${DOWNLOAD_ENDPOINT}?${params.toString()}`;

    // Reset downloading state after a delay
    setTimeout(() => setDownloading(null), 2000);
  };

  const releaseUrl = release?.html_url ?? RELEASES_PAGE;
  const detectedAssets =
    platform !== "unknown" ? assetsByPlatform[platform] : [];
  const recommended = detectedAssets[0];

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted to-background">
      {/* Header */}
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Download Qontinui Runner
          </h1>
          <p className="text-lg text-muted-foreground mb-2">
            {release ? (
              <>
                Latest version:{" "}
                <span className="font-semibold">{release.version}</span>
                {release.prerelease ? " (Beta)" : ""}
              </>
            ) : loadError ? (
              "Browse all releases on GitHub below."
            ) : (
              "Loading latest version…"
            )}
          </p>
          {release?.published_at && (
            <p className="text-sm text-muted-foreground">
              Released{" "}
              {new Date(release.published_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          )}
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
              {recommended ? (
                <>
                  <p className="text-muted-foreground mb-4">
                    We&apos;ve detected you&apos;re using{" "}
                    {getPlatformName(platform)}. Download the recommended
                    version below.
                  </p>
                  <Button
                    size="lg"
                    disabled={
                      downloading ===
                      `${recommended.platform}-${recommended.kind}-${recommended.arch}`
                    }
                    onClick={() => handleDownload(recommended)}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {downloading ===
                    `${recommended.platform}-${recommended.kind}-${recommended.arch}` ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Starting Download...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-5 w-5" />
                        Download for {getPlatformName(platform)}
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <div>
                  <p className="text-muted-foreground mb-3 font-medium">
                    {release
                      ? `Pre-built ${getPlatformName(platform)} binaries aren't in the latest release yet.`
                      : "Resolving the latest release…"}
                  </p>
                  {BUILD_FROM_SOURCE[platform] && (
                    <a
                      href={BUILD_FROM_SOURCE[platform]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-muted-foreground hover:bg-muted-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
                    >
                      <Github className="w-4 h-4" />
                      Build from source
                    </a>
                  )}
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
          <PlatformDownloads
            platform="windows"
            icon="🪟"
            currentPlatform={platform}
            assets={assetsByPlatform.windows}
            loading={!release && !loadError}
            downloading={downloading}
            onDownload={handleDownload}
          />
          <PlatformDownloads
            platform="macos"
            icon="🍎"
            currentPlatform={platform}
            assets={assetsByPlatform.macos}
            loading={!release && !loadError}
            downloading={downloading}
            onDownload={handleDownload}
          />
          <PlatformDownloads
            platform="linux"
            icon="🐧"
            currentPlatform={platform}
            assets={assetsByPlatform.linux}
            loading={!release && !loadError}
            downloading={downloading}
            onDownload={handleDownload}
          />
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
              href={releaseUrl}
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
                On macOS, open the .dmg and drag Qontinui Runner to
                Applications; first launch may require right-click → Open. On
                Linux, mark the AppImage executable (chmod +x) and run it, or
                install the .deb with your package manager.
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

function PlatformDownloads({
  platform,
  icon,
  currentPlatform,
  assets,
  loading,
  downloading,
  onDownload,
}: {
  platform: Exclude<Platform, "unknown">;
  icon: string;
  currentPlatform: Platform;
  assets: ReleaseAsset[];
  loading: boolean;
  downloading: string | null;
  onDownload: (asset: ReleaseAsset) => void;
}) {
  const isCurrentPlatform = platform === currentPlatform;
  const hasAssets = assets.length > 0;

  return (
    <div
      className={`bg-card rounded-lg border ${isCurrentPlatform ? "border-primary shadow-lg" : "border-border"} overflow-hidden ${!hasAssets && !loading ? "opacity-60" : ""}`}
    >
      <div
        className={`${isCurrentPlatform ? "bg-primary/10" : "bg-muted"} px-6 py-4 border-b border-border`}
      >
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          {getPlatformName(platform)}
          {isCurrentPlatform && (
            <span className="text-sm font-normal bg-primary text-primary-foreground px-2 py-1 rounded">
              Your Platform
            </span>
          )}
          {!hasAssets && !loading && (
            <span className="text-sm font-normal bg-amber-500 text-white px-2 py-1 rounded">
              Build from source
            </span>
          )}
        </h2>
      </div>
      <div className="p-6 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Resolving latest release…
          </div>
        ) : hasAssets ? (
          assets.map((asset) => {
            const key = `${asset.platform}-${asset.kind}-${asset.arch}`;
            const size = formatSize(asset.size);
            return (
              <div
                key={asset.name}
                className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border hover:border-primary/50 transition-colors"
              >
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    {assetLabel(asset)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {assetTypeLabel(asset.kind)}
                    {size ? ` • ${size}` : ""}
                  </p>
                </div>
                <Button
                  disabled={downloading === key}
                  onClick={() => onDownload(asset)}
                  className="flex-shrink-0 bg-primary hover:bg-primary/90"
                >
                  {downloading === key ? (
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
            );
          })
        ) : (
          <div>
            <p className="text-muted-foreground mb-4">
              Pre-built {getPlatformName(platform)} binaries are not in the
              latest release. For now, please build from source.
            </p>
            <a
              href={
                BUILD_FROM_SOURCE[platform] ??
                "https://github.com/qontinui/qontinui-runner#installation"
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-muted-foreground hover:bg-muted-foreground/90 text-background px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              <Github className="w-4 h-4" />
              Build Instructions
            </a>
          </div>
        )}
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
