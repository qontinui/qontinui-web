'use client';

import { useState, useEffect } from 'react';
import { Download, Shield, CheckCircle2, Github, AlertCircle, Apple, MonitorSmartphone, Loader2 } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

interface ReleaseInfo {
  version: string;
  date: string;
  github_url: string;
}

// Latest release info - update this when releasing
const LATEST_RELEASE: ReleaseInfo = {
  version: '0.1.0',
  date: '2025-01-15',
  github_url: 'https://github.com/jspinak/qontinui-runner/releases/tag/v0.1.0'
};

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown';

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('linux')) return 'linux';

  return 'unknown';
}

function getPlatformIcon(platform: Platform) {
  switch (platform) {
    case 'windows':
      return <MonitorSmartphone className="h-6 w-6" />;
    case 'macos':
      return <Apple className="h-6 w-6" />;
    case 'linux':
      return <MonitorSmartphone className="h-6 w-6" />;
    default:
      return <Download className="h-6 w-6" />;
  }
}

function getPlatformName(platform: Platform): string {
  switch (platform) {
    case 'windows': return 'Windows';
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    default: return 'Unknown';
  }
}

export const metadata = {
  title: "Download Qontinui Runner",
  description:
    "Download Qontinui Runner for Windows, macOS, and Linux. Free and open source GUI automation desktop application.",
};

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const handleDownload = async (selectedPlatform: Platform, filename: string) => {
    setDownloading(filename);

    // Track download (privacy-friendly)
    try {
      await fetch('/api/analytics/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedPlatform,
          version: LATEST_RELEASE.version,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (e) {
      // Silent fail - don't block download
      console.error('Analytics error:', e);
    }

    // Redirect to GitHub release download
    const downloadUrl = `${LATEST_RELEASE.github_url.replace('/tag/', '/download/')}/${filename}`;
    window.location.href = downloadUrl;

    // Reset downloading state after a delay
    setTimeout(() => setDownloading(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Download Qontinui Runner
          </h1>
          <p className="text-lg text-slate-600 mb-2">
            Latest version: <span className="font-semibold">{LATEST_RELEASE.version}</span> (Beta)
          </p>
          <p className="text-sm text-slate-500">
            Released {LATEST_RELEASE.date}
          </p>
        </div>
      </section>

      {/* Detected Platform Callout */}
      {platform !== 'unknown' && (
        <section className="container mx-auto px-4 pb-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                {getPlatformIcon(platform)}
                <h2 className="text-xl font-semibold text-slate-900">
                  Detected Platform: {getPlatformName(platform)}
                </h2>
              </div>
              <p className="text-slate-700 mb-4">
                We've detected you're using {getPlatformName(platform)}. Download the recommended version below.
              </p>
              {platform === 'windows' && (
                <Button
                  size="lg"
                  disabled={downloading === 'qontinui-runner-windows-v0.1.0.msi'}
                  onClick={() => handleDownload('windows', 'qontinui-runner-windows-v0.1.0.msi')}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {downloading === 'qontinui-runner-windows-v0.1.0.msi' ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Starting Download...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-5 w-5" />
                      Download for Windows
                    </>
                  )}
                </Button>
              )}
              {platform === 'macos' && (
                <Button
                  size="lg"
                  disabled={downloading === 'qontinui-runner-macos-v0.1.0.dmg'}
                  onClick={() => handleDownload('macos', 'qontinui-runner-macos-v0.1.0.dmg')}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {downloading === 'qontinui-runner-macos-v0.1.0.dmg' ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Starting Download...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-5 w-5" />
                      Download for macOS
                    </>
                  )}
                </Button>
              )}
              {platform === 'linux' && (
                <Button
                  size="lg"
                  disabled={downloading === 'qontinui-runner-linux-v0.1.0.AppImage'}
                  onClick={() => handleDownload('linux', 'qontinui-runner-linux-v0.1.0.AppImage')}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {downloading === 'qontinui-runner-linux-v0.1.0.AppImage' ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Starting Download...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-5 w-5" />
                      Download for Linux
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Installation Warning (for unsigned builds) */}
      <section className="container mx-auto px-4 pb-8">
        <div className="max-w-4xl mx-auto">
          <Alert className="border-amber-300 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-slate-700">
              <strong>First time installation:</strong> You may see security warnings
              because the app is not yet code-signed. We're working on this!
              {' '}
              <Link href="/docs/runner/installation" className="underline text-blue-600 hover:text-blue-800">
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
                name: "Windows Installer",
                file: "qontinui-runner-windows-v0.1.0.msi",
                size: "~4 MB",
                type: "MSI Package",
                signed: false, // Update to true when signed
                description: "Standard Windows installer (Windows 10 or later)",
                onDownload: () => handleDownload('windows', 'qontinui-runner-windows-v0.1.0.msi'),
                downloading: downloading === 'qontinui-runner-windows-v0.1.0.msi'
              },
            ]}
          />

          {/* macOS */}
          <DownloadSection
            platform="macOS"
            icon="🍎"
            currentPlatform={platform}
            downloads={[
              {
                name: "macOS Universal",
                file: "qontinui-runner-macos-v0.1.0.dmg",
                size: "~4 MB",
                type: "DMG Image",
                signed: false, // Update to true when signed
                description: "For Intel and Apple Silicon Macs (macOS 11+)",
                onDownload: () => handleDownload('macos', 'qontinui-runner-macos-v0.1.0.dmg'),
                downloading: downloading === 'qontinui-runner-macos-v0.1.0.dmg'
              },
            ]}
          />

          {/* Linux */}
          <DownloadSection
            platform="Linux"
            icon="🐧"
            currentPlatform={platform}
            downloads={[
              {
                name: "AppImage (Universal)",
                file: "qontinui-runner-linux-v0.1.0.AppImage",
                size: "~4 MB",
                type: "AppImage",
                signed: false,
                description: "Runs on most Linux distributions",
                onDownload: () => handleDownload('linux', 'qontinui-runner-linux-v0.1.0.AppImage'),
                downloading: downloading === 'qontinui-runner-linux-v0.1.0.AppImage'
              },
            ]}
          />
        </div>
      </section>

      {/* GitHub Releases */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Github className="w-6 h-6 text-slate-700" />
              <h2 className="text-xl font-semibold text-slate-900">
                GitHub Releases
              </h2>
            </div>
            <p className="text-slate-600 mb-4">
              All releases are available on GitHub with checksums and release notes.
            </p>
            <a
              href={LATEST_RELEASE.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
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
          <h2 className="text-2xl font-bold mb-8 text-slate-900">
            Installation Instructions
          </h2>

          <div className="space-y-6">
            <InstallInstructions
              platform="Windows"
              steps={[
                "Download the .msi installer",
                "Run the installer",
                "⚠️ Windows SmartScreen warning will appear (app not yet signed)",
                "Click 'More info' → 'Run anyway'",
                "Follow the installation wizard",
                "Launch Qontinui Runner from the Start Menu",
              ]}
            />

            <InstallInstructions
              platform="macOS"
              steps={[
                "Download the .dmg file",
                "Open the DMG file",
                "Drag Qontinui Runner to Applications",
                "⚠️ First launch: Right-click app → Open (Gatekeeper warning)",
                "Click 'Open' in the dialog",
                "Subsequent launches will work normally",
              ]}
            />

            <InstallInstructions
              platform="Linux"
              steps={[
                "Download the .AppImage file",
                "Make it executable: chmod +x qontinui-runner-*.AppImage",
                "Run: ./qontinui-runner-*.AppImage",
                "Optional: Integrate with system menu using AppImageLauncher",
              ]}
            />
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/docs/runner/installation"
              className="text-blue-600 hover:text-blue-800 font-semibold underline"
            >
              → Detailed Installation Guide with Screenshots
            </Link>
          </div>
        </div>
      </section>

      {/* System Requirements */}
      <section className="bg-slate-50 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-8 text-slate-900">
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
          <h2 className="text-2xl font-bold mb-4 text-slate-900">
            Need Help?
          </h2>
          <p className="text-slate-600 mb-6">
            Check out our documentation or report issues on GitHub
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/docs/runner"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/jspinak/qontinui-runner/issues"
              className="bg-slate-100 hover:bg-slate-200 text-slate-900 px-6 py-2 rounded-lg font-semibold transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an Issue
            </a>
            <Link
              href="/docs/getting-started"
              className="bg-slate-100 hover:bg-slate-200 text-slate-900 px-6 py-2 rounded-lg font-semibold transition-colors"
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
    <div className={`bg-white rounded-lg border ${isCurrentPlatform ? 'border-blue-400 shadow-lg' : 'border-slate-200'} overflow-hidden`}>
      <div className={`${isCurrentPlatform ? 'bg-blue-50' : 'bg-slate-50'} px-6 py-4 border-b border-slate-200`}>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          {platform}
          {isCurrentPlatform && (
            <span className="text-sm font-normal bg-blue-600 text-white px-2 py-1 rounded">
              Your Platform
            </span>
          )}
        </h2>
      </div>
      <div className="p-6 space-y-4">
        {downloads.map((download, idx) => (
          <div
            key={idx}
            className="flex items-start justify-between gap-4 p-4 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-slate-900">
                  {download.name}
                </h3>
                {download.signed && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Signed
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 mb-2">
                {download.description}
              </p>
              <p className="text-xs text-slate-500">
                {download.type} • {download.size}
              </p>
            </div>
            <Button
              disabled={download.downloading}
              onClick={download.onDownload}
              className="flex-shrink-0 bg-blue-600 hover:bg-blue-700"
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
    <div className="bg-white p-6 rounded-lg border border-slate-200">
      <h3 className="text-lg font-semibold mb-4 text-slate-900">{platform}</h3>
      <ol className="space-y-2">
        {steps.map((step, idx) => (
          <li key={idx} className="flex gap-3 text-slate-700">
            <span className="font-semibold text-blue-600 flex-shrink-0">
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
    <div className="bg-white p-6 rounded-lg border border-slate-200">
      <h3 className="font-semibold mb-4 text-slate-900">{platform}</h3>
      <ul className="space-y-2">
        {requirements.map((req, idx) => (
          <li key={idx} className="flex gap-2 text-sm text-slate-700">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>{req}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
