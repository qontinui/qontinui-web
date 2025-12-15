"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  Loader2,
  Monitor,
  Apple,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  HardDrive,
} from "lucide-react";

type Platform = "windows" | "macos" | "linux";

interface DownloadOption {
  platform: Platform;
  name: string;
  icon: React.ReactNode;
  description: string;
  files: {
    name: string;
    label: string;
    url: string;
    size?: string;
    recommended?: boolean;
  }[];
  instructions: string[];
}

const GITHUB_RELEASES_BASE =
  "https://github.com/qontinui/qontinui-runner/releases/latest/download";

const downloadOptions: DownloadOption[] = [
  {
    platform: "windows",
    name: "Windows",
    icon: <Monitor className="w-8 h-8" />,
    description: "Windows 10/11 (64-bit)",
    files: [
      {
        name: "qontinui-runner_x64-setup.exe",
        label: "Installer (.exe)",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_x64-setup.exe`,
        recommended: true,
      },
      {
        name: "qontinui-runner_x64_en-US.msi",
        label: "MSI Package",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_x64_en-US.msi`,
      },
    ],
    instructions: [
      "Download the installer (.exe recommended)",
      "Run the installer and follow the prompts",
      "Launch Qontinui Runner from the Start Menu",
      "Log in with your Qontinui account",
    ],
  },
  {
    platform: "macos",
    name: "macOS",
    icon: <Apple className="w-8 h-8" />,
    description: "macOS 11+ (Intel & Apple Silicon)",
    files: [
      {
        name: "qontinui-runner_universal.dmg",
        label: "Universal DMG",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_universal.dmg`,
        recommended: true,
      },
      {
        name: "qontinui-runner_aarch64.dmg",
        label: "Apple Silicon (M1/M2)",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_aarch64.dmg`,
      },
      {
        name: "qontinui-runner_x64.dmg",
        label: "Intel Mac",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_x64.dmg`,
      },
    ],
    instructions: [
      "Download the DMG file (Universal recommended)",
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
    files: [
      {
        name: "qontinui-runner_amd64.AppImage",
        label: "AppImage (Universal)",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_amd64.AppImage`,
        recommended: true,
      },
      {
        name: "qontinui-runner_amd64.deb",
        label: "Debian/Ubuntu (.deb)",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_amd64.deb`,
      },
      {
        name: "qontinui-runner_amd64.rpm",
        label: "Fedora/RHEL (.rpm)",
        url: `${GITHUB_RELEASES_BASE}/qontinui-runner_amd64.rpm`,
      },
    ],
    instructions: [
      "Download the appropriate package for your distribution",
      "For AppImage: chmod +x and run directly",
      "For .deb: sudo dpkg -i qontinui-runner_amd64.deb",
      "For .rpm: sudo rpm -i qontinui-runner_amd64.rpm",
    ],
  },
];

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "windows";

  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "macos";
  if (userAgent.includes("linux")) return "linux";
  return "windows";
}

export default function DownloadPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>("windows");
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(
    null
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const platform = detectPlatform();
    setDetectedPlatform(platform);
    setSelectedPlatform(platform);
  }, []);

  const handleDownload = (url: string) => {
    window.open(url, "_blank");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const currentOption = downloadOptions.find(
    (opt) => opt.platform === selectedPlatform
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/connect-runner")}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Connect Runner
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Download Runner
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-5xl mx-auto">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold mb-3">Download Qontinui Runner</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            The desktop runner connects your computer to the Qontinui platform,
            enabling visual automation and workflow execution on your machine.
          </p>
        </div>

        {/* Platform Selector */}
        <div className="flex justify-center gap-4 mb-8">
          {downloadOptions.map((option) => (
            <button
              key={option.platform}
              onClick={() => setSelectedPlatform(option.platform)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                selectedPlatform === option.platform
                  ? "bg-[#00D9FF]/10 border-[#00D9FF]/50 text-[#00D9FF]"
                  : "bg-[#1A1A1B]/50 border-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-white"
              }`}
            >
              {option.icon}
              <span className="font-medium">{option.name}</span>
              {option.platform === detectedPlatform && (
                <Badge
                  variant="outline"
                  className="text-xs border-[#00D9FF]/50 text-[#00D9FF]"
                >
                  Detected
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Download Options for Selected Platform */}
        {currentOption && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Download Files */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-[#00D9FF]" />
                  Download for {currentOption.name}
                </CardTitle>
                <p className="text-sm text-gray-400">
                  {currentOption.description}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {currentOption.files.map((file) => (
                  <div
                    key={file.name}
                    className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                      file.recommended
                        ? "bg-[#00D9FF]/5 border-[#00D9FF]/30 hover:border-[#00D9FF]/50"
                        : "bg-[#0A0A0B]/50 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          file.recommended
                            ? "bg-[#00D9FF]/20"
                            : "bg-gray-800/50"
                        }`}
                      >
                        <Download
                          className={`w-5 h-5 ${file.recommended ? "text-[#00D9FF]" : "text-gray-400"}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{file.label}</span>
                          {file.recommended && (
                            <Badge className="bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30 text-xs">
                              Recommended
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{file.name}</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleDownload(file.url)}
                      size="sm"
                      className={
                        file.recommended
                          ? "bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
                          : "bg-gray-700 hover:bg-gray-600"
                      }
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                ))}

                <div className="pt-4 border-t border-gray-800">
                  <Link
                    href="https://github.com/qontinui/qontinui-runner/releases"
                    target="_blank"
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-[#00D9FF] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View all releases on GitHub
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Installation Instructions */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#00FF88]" />
                  Installation Instructions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {currentOption.instructions.map((instruction, index) => (
                    <li key={index} className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] flex items-center justify-center text-black font-bold text-sm">
                        {index + 1}
                      </div>
                      <span className="text-gray-300 pt-0.5">
                        {instruction}
                      </span>
                    </li>
                  ))}
                </ol>

                {currentOption.platform === "macos" && (
                  <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-400 mb-1">
                          macOS Security Note
                        </p>
                        <p className="text-sm text-gray-400">
                          Since the app is not signed with an Apple Developer
                          certificate, you&apos;ll need to right-click and
                          select &quot;Open&quot; the first time you launch it.
                          This is a one-time requirement.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {currentOption.platform === "linux" && (
                  <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-400 mb-1">
                          Linux Dependencies
                        </p>
                        <p className="text-sm text-gray-400">
                          The runner requires WebKitGTK. On Ubuntu/Debian,
                          install with:{" "}
                          <code className="bg-gray-800 px-1 rounded">
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
        )}

        {/* System Requirements */}
        <Card className="mt-6 bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>System Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-[#00D9FF]" />
                  Windows
                </h4>
                <ul className="text-sm text-gray-400 space-y-1">
                  <li>Windows 10 or 11 (64-bit)</li>
                  <li>4 GB RAM minimum</li>
                  <li>500 MB disk space</li>
                  <li>WebView2 Runtime (included)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Apple className="w-4 h-4 text-[#00D9FF]" />
                  macOS
                </h4>
                <ul className="text-sm text-gray-400 space-y-1">
                  <li>macOS 11 (Big Sur) or later</li>
                  <li>Intel or Apple Silicon</li>
                  <li>4 GB RAM minimum</li>
                  <li>500 MB disk space</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-[#00D9FF]" />
                  Linux
                </h4>
                <ul className="text-sm text-gray-400 space-y-1">
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
          <p className="text-gray-400 mb-4">Need help setting up the runner?</p>
          <div className="flex justify-center gap-4">
            <Link href="/connect-runner">
              <Button variant="outline" className="border-gray-700">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Setup Guide
              </Button>
            </Link>
            <Link
              href="https://github.com/qontinui/qontinui-runner/issues"
              target="_blank"
            >
              <Button variant="outline" className="border-gray-700">
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
