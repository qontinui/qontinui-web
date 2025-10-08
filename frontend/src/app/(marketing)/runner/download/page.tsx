import { Download, Shield, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Download Qontinui Runner",
  description:
    "Download Qontinui Runner for Windows, macOS, and Linux. All releases are code-signed and verified for security.",
};

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Download Qontinui Runner
          </h1>
          <p className="text-lg text-slate-600">
            Latest version: <span className="font-semibold">0.1.0</span> (Beta)
          </p>
        </div>
      </section>

      {/* Downloads */}
      <section className="container mx-auto px-4 pb-16">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Windows */}
          <DownloadSection
            platform="Windows"
            icon="🪟"
            downloads={[
              {
                name: "Windows Installer (Recommended)",
                file: "Qontinui-Runner-0.1.0-x64-setup.exe",
                size: "3.8 MB",
                type: "NSIS Installer",
                signed: true,
                description: "Standard Windows installer with setup wizard",
              },
              {
                name: "Windows MSI Package",
                file: "Qontinui-Runner-0.1.0-x64.msi",
                size: "5.6 MB",
                type: "MSI Package",
                signed: true,
                description: "For enterprise deployments and IT departments",
              },
            ]}
          />

          {/* macOS */}
          <DownloadSection
            platform="macOS"
            icon="🍎"
            downloads={[
              {
                name: "macOS Apple Silicon",
                file: "Qontinui-Runner-0.1.0-arm64.dmg",
                size: "~4 MB",
                type: "DMG Image",
                signed: true,
                description: "For M1, M2, M3 Mac computers",
              },
              {
                name: "macOS Intel",
                file: "Qontinui-Runner-0.1.0-x64.dmg",
                size: "~4 MB",
                type: "DMG Image",
                signed: true,
                description: "For Intel-based Mac computers",
              },
            ]}
          />

          {/* Linux */}
          <DownloadSection
            platform="Linux"
            icon="🐧"
            downloads={[
              {
                name: "Debian/Ubuntu Package",
                file: "qontinui-runner_0.1.0_amd64.deb",
                size: "~4 MB",
                type: "DEB Package",
                signed: false,
                description: "For Debian, Ubuntu, and derivatives",
              },
              {
                name: "Fedora/RHEL Package",
                file: "qontinui-runner-0.1.0-1.x86_64.rpm",
                size: "~4 MB",
                type: "RPM Package",
                signed: false,
                description: "For Fedora, RHEL, CentOS, and derivatives",
              },
              {
                name: "AppImage (Universal)",
                file: "qontinui-runner_0.1.0_amd64.AppImage",
                size: "~4 MB",
                type: "AppImage",
                signed: false,
                description: "Runs on most Linux distributions",
              },
            ]}
          />
        </div>
      </section>

      {/* Security Information */}
      <section className="bg-slate-50 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <Shield className="w-8 h-8 text-blue-600" />
              <h2 className="text-2xl font-bold text-slate-900">
                Security & Verification
              </h2>
            </div>

            <div className="space-y-6">
              {/* Windows Signing */}
              <div className="bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Windows Code Signing
                </h3>
                <p className="text-slate-700 mb-4">
                  All Windows installers are digitally signed by the{" "}
                  <a
                    href="https://signpath.io/"
                    className="text-blue-600 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    SignPath Foundation
                  </a>
                  , a non-profit organization providing free code signing for
                  open source projects. This ensures the software has not been
                  tampered with and comes from a trusted source.
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold text-slate-700 hover:text-slate-900">
                    Certificate Details
                  </summary>
                  <div className="mt-3 bg-slate-50 p-4 rounded border border-slate-200 font-mono text-xs space-y-1">
                    <p>
                      Subject: CN=SignPath Foundation, O=SignPath Foundation,
                      L=Lewes, S=Delaware, C=US
                    </p>
                    <p>Issuer: DigiCert</p>
                    <p>Algorithm: SHA256</p>
                    <p>Timestamp: DigiCert Timestamp Service</p>
                  </div>
                </details>
              </div>

              {/* macOS Signing */}
              <div className="bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  macOS Signing & Notarization
                </h3>
                <p className="text-slate-700">
                  macOS releases are signed with our Apple Developer ID
                  certificate and notarized by Apple. This ensures the app meets
                  Apple's security requirements and will run without warnings on
                  macOS 10.15 and later.
                </p>
              </div>

              {/* Linux Verification */}
              <div className="bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  Linux Package Verification
                </h3>
                <p className="text-slate-700 mb-3">
                  Linux packages can be verified using GPG signatures and
                  checksums provided with each release.
                </p>
                <div className="bg-slate-50 p-4 rounded border border-slate-200">
                  <p className="text-sm font-mono text-slate-700">
                    # Verify checksum
                    <br />
                    sha256sum -c checksums.txt
                  </p>
                </div>
              </div>
            </div>
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
                "Download the installer (.exe or .msi)",
                "Run the installer",
                "Windows may show a SmartScreen warning - click 'More info' and 'Run anyway'",
                "Follow the installation wizard",
                "Launch Qontinui Runner from the Start Menu",
              ]}
            />

            <InstallInstructions
              platform="macOS"
              steps={[
                "Download the DMG file for your architecture (ARM64 for M1/M2/M3, x64 for Intel)",
                "Open the DMG file",
                "Drag Qontinui Runner to Applications",
                "Launch from Applications (right-click and Open on first launch)",
              ]}
            />

            <InstallInstructions
              platform="Linux"
              steps={[
                "Download the package for your distribution",
                "Install using your package manager:",
                "  • Debian/Ubuntu: sudo dpkg -i qontinui-runner_*.deb",
                "  • Fedora/RHEL: sudo rpm -i qontinui-runner-*.rpm",
                "  • AppImage: chmod +x qontinui-runner_*.AppImage && ./qontinui-runner_*.AppImage",
                "Launch from your application menu or terminal",
              ]}
            />
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
                  "macOS 10.15 (Catalina) or later",
                  "Apple Silicon or Intel processor",
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
          <div className="flex gap-4 justify-center">
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
          </div>
        </div>
      </section>
    </div>
  );
}

function DownloadSection({
  platform,
  icon,
  downloads,
}: {
  platform: string;
  icon: string;
  downloads: Array<{
    name: string;
    file: string;
    size: string;
    type: string;
    signed: boolean;
    description: string;
  }>;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <span className="text-3xl">{icon}</span>
          {platform}
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
            <a
              href={`/downloads/${download.file}`}
              className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
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
