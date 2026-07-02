"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  Monitor,
  Apple,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Loader2,
} from "lucide-react";

type Platform = "windows" | "macos" | "linux";

// Asset + release shapes returned by the backend, which resolves "latest"
// dynamically against the GitHub Releases API. The runner release pipeline
// version-stamps every asset filename (e.g. `Qontinui.Runner_1.0.1_x64-setup.exe`),
// so GitHub's `/releases/latest/download/<file>` permalink can't be hardcoded —
// the version changes every release. We read the live asset list instead.
interface ReleaseAsset {
  name: string;
  url: string;
  size?: number;
  content_type?: string;
  platform: Platform;
  kind: "msi" | "exe" | "dmg" | "appimage" | "deb";
  arch: "x64" | "arm64" | "unknown";
}

interface LatestRelease {
  version: string | null;
  tag: string | null;
  name: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
  // False when GitHub couldn't be reached; the page degrades to the GitHub
  // releases link rather than showing stale/absent versions.
  available: boolean;
  reason: string | null;
}

const LATEST_ENDPOINT = "/api/v1/releases/runner/latest";
const RELEASES_PAGE = "https://github.com/qontinui/qontinui-runner/releases";

interface PlatformMeta {
  platform: Platform;
  name: string;
  icon: React.ReactNode;
  description: string;
  instructions: string[];
}

// Static per-platform presentation. Download files are resolved dynamically
// from the latest release, not hardcoded here.
const PLATFORM_META: PlatformMeta[] = [
  {
    platform: "windows",
    name: "Windows",
    icon: <Monitor className="w-8 h-8" />,
    description: "Windows 10/11 (64-bit)",
    instructions: [
      "Download the installer (.exe)",
      "Run the installer — Windows SmartScreen may warn (unsigned): click \"More info\" → \"Run anyway\"",
      "Launch Qontinui Runner from the Start Menu",
      "Log in with your Qontinui account",
    ],
  },
  {
    platform: "macos",
    name: "macOS",
    icon: <Apple className="w-8 h-8" />,
    description: "macOS 11+ (Intel & Apple Silicon)",
    instructions: [
      "Download the DMG file",
      "Open the DMG and drag Qontinui Runner to Applications",
      "Right-click the app and select 'Open' (first time only)",
      "Log in with your Qontinui account",
    ],
  },
  {
    platform: "linux",
    name: "Linux",
    icon: <HardDrive className="w-8 h-8" />,
    description: "Ubuntu 20.04+, Debian 10+, Fedora 34+",
    instructions: [
      "Download the appropriate package for your distribution",
      "For AppImage: chmod +x and run directly",
      "For .deb: sudo dpkg -i qontinui-runner_amd64.deb",
      "For .rpm: sudo rpm -i qontinui-runner_amd64.rpm",
    ],
  },
];

// Human label + recommendation for an asset, derived from its kind/arch.
function assetLabel(asset: ReleaseAsset): string {
  switch (asset.kind) {
    case "exe":
      return "Installer (.exe)";
    case "msi":
      return "MSI Package";
    case "dmg":
      if (asset.arch === "arm64") return "Apple Silicon (.dmg)";
      if (asset.arch === "x64") return "Intel (.dmg)";
      return "Universal (.dmg)";
    case "appimage":
      return "AppImage (Universal)";
    case "deb":
      return "Debian/Ubuntu (.deb)";
    default:
      return asset.name;
  }
}

// The recommended installer kind per platform (matches the release pipeline:
// Windows ships NSIS .exe; macOS .dmg; Linux .appimage).
const RECOMMENDED_KIND: Record<Platform, ReleaseAsset["kind"]> = {
  windows: "exe",
  macos: "dmg",
  linux: "appimage",
};

function formatSize(bytes?: number): string | undefined {
  if (!bytes) return undefined;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "windows";

  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "macos";
  if (userAgent.includes("linux")) return "linux";
  return "windows";
}

export default function DownloadPage() {
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>("windows");
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("windows");
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const platform = detectPlatform();
    setDetectedPlatform(platform);
    setSelectedPlatform(platform);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(LATEST_ENDPOINT)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: LatestRelease) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) setRelease(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentMeta = PLATFORM_META.find(
    (opt) => opt.platform === selectedPlatform
  )!;

  // Assets for the selected platform, recommended kind first.
  const currentAssets = useMemo(() => {
    const assets = (release?.assets ?? []).filter(
      (a) => a.platform === selectedPlatform
    );
    const recommended = RECOMMENDED_KIND[selectedPlatform];
    return [...assets].sort((a, b) => {
      if (a.kind === recommended && b.kind !== recommended) return -1;
      if (b.kind === recommended && a.kind !== recommended) return 1;
      return 0;
    });
  }, [release, selectedPlatform]);

  const versionLabel = release?.available && release.version
    ? `v${release.version}`
    : null;

  const handleDownload = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Download Runner</h1>
          {versionLabel && (
            <Badge
              variant="outline"
              className="text-xs border-primary/50 text-primary"
            >
              {versionLabel}
            </Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          Desktop app for AI-assisted development
        </span>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* Platform Selector */}
        <div className="flex justify-center gap-4 mb-8">
          {PLATFORM_META.map((option) => (
            <button
              key={option.platform}
              onClick={() => setSelectedPlatform(option.platform)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                selectedPlatform === option.platform
                  ? "bg-primary/10 border-primary/50 text-primary"
                  : "bg-muted border-border text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {option.icon}
              <span className="font-medium">{option.name}</span>
              {option.platform === detectedPlatform && (
                <Badge
                  variant="outline"
                  className="text-xs border-primary/50 text-primary"
                >
                  Detected
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Download Options for Selected Platform */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Download Files */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Download className="w-5 h-5 text-primary" />
                Download for {currentMeta.name}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {currentMeta.description}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Resolving the latest release…
                </div>
              ) : currentAssets.length > 0 ? (
                currentAssets.map((asset) => {
                  const recommended =
                    asset.kind === RECOMMENDED_KIND[selectedPlatform];
                  const size = formatSize(asset.size);
                  return (
                    <div
                      key={asset.name}
                      className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                        recommended
                          ? "bg-primary/5 border-primary/30 hover:border-primary/50"
                          : "bg-background border-border hover:border-border"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            recommended ? "bg-primary/20" : "bg-muted"
                          }`}
                        >
                          <Download
                            className={`w-5 h-5 ${recommended ? "text-primary" : "text-muted-foreground"}`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {assetLabel(asset)}
                            </span>
                            {recommended && (
                              <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                                Recommended
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {asset.name}
                            {size ? ` · ${size}` : ""}
                          </p>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleDownload(asset.url)}
                        size="sm"
                        className={
                          recommended
                            ? "bg-primary hover:bg-primary/80 text-primary-foreground"
                            : "bg-muted hover:bg-muted/80"
                        }
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 rounded-lg border border-border bg-muted/40">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium mb-1">
                        No {currentMeta.name} installer in the latest release
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Prebuilt installers currently ship for Windows. For{" "}
                        {currentMeta.name}, build from source — see the{" "}
                        <Link
                          href={RELEASES_PAGE}
                          target="_blank"
                          className="text-primary hover:underline"
                        >
                          releases page
                        </Link>
                        .
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-border">
                <Link
                  href={RELEASES_PAGE}
                  target="_blank"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View all releases on GitHub
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Installation Instructions */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Installation Instructions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {currentMeta.instructions.map((instruction, index) => (
                  <li key={index} className="flex gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                      {index + 1}
                    </div>
                    <span className="text-muted-foreground pt-0.5">
                      {instruction}
                    </span>
                  </li>
                ))}
              </ol>

              {currentMeta.platform === "macos" && (
                <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-400 mb-1">
                        macOS Security Note
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Since the app is not signed with an Apple Developer
                        certificate, you&apos;ll need to right-click and select
                        &quot;Open&quot; the first time you launch it. This is a
                        one-time requirement.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {currentMeta.platform === "linux" && (
                <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-400 mb-1">
                        Linux Dependencies
                      </p>
                      <p className="text-sm text-muted-foreground">
                        The runner requires WebKitGTK. On Ubuntu/Debian, install
                        with:{" "}
                        <code className="bg-muted px-1 rounded">
                          sudo apt install libwebkit2gtk-4.1-0
                        </code>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* System Requirements */}
        <Card className="mt-6 bg-background border-border">
          <CardHeader>
            <CardTitle>System Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-primary" />
                  Windows
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>Windows 10 or 11 (64-bit)</li>
                  <li>4 GB RAM minimum</li>
                  <li>500 MB disk space</li>
                  <li>WebView2 Runtime (included)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Apple className="w-4 h-4 text-primary" />
                  macOS
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>macOS 11 (Big Sur) or later</li>
                  <li>Intel or Apple Silicon</li>
                  <li>4 GB RAM minimum</li>
                  <li>500 MB disk space</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-primary" />
                  Linux
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>Ubuntu 20.04+, Debian 10+, Fedora 34+</li>
                  <li>4 GB RAM minimum</li>
                  <li>500 MB disk space</li>
                  <li>WebKitGTK 4.1</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Help Section */}
        <div className="mt-8 text-center">
          <p className="text-muted-foreground mb-4">
            Need help setting up the runner?
          </p>
          <div className="flex justify-center gap-4">
            <Link href="/connect-runner">
              <Button variant="outline" className="border-border">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Setup Guide
              </Button>
            </Link>
            <Link
              href="https://github.com/qontinui/qontinui-runner/issues"
              target="_blank"
            >
              <Button variant="outline" className="border-border">
                <ExternalLink className="w-4 h-4 mr-2" />
                Report an Issue
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
