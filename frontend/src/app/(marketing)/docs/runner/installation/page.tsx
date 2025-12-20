import { CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata = {
  title: "Runner Installation Guide - Qontinui",
  description:
    "Detailed installation instructions for Qontinui Runner on Windows, macOS, and Linux, including workarounds for unsigned applications.",
};

export default function InstallationGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-4">Runner Installation Guide</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Step-by-step instructions for installing Qontinui Runner on your
          system.
        </p>

        {/* Download First */}
        <Alert className="mb-8 border-primary/30 bg-primary/10">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription className="text-foreground">
            <strong>First time here?</strong> Make sure to{" "}
            <Link
              href="/runner/download"
              className="underline text-primary hover:text-primary/80"
            >
              download Qontinui Runner
            </Link>{" "}
            before following these instructions.
          </AlertDescription>
        </Alert>

        {/* Windows Section */}
        <section className="mb-12">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            <span>🪟</span> Windows Installation
          </h2>

          <div className="space-y-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-4">
                Standard Installation
              </h3>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    1.
                  </span>
                  <div>
                    <p className="font-medium">Download the .msi installer</p>
                    <p className="text-sm text-muted-foreground">
                      Get the latest version from the{" "}
                      <Link
                        href="/runner/download"
                        className="text-primary underline"
                      >
                        download page
                      </Link>
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    2.
                  </span>
                  <div>
                    <p className="font-medium">Run the installer</p>
                    <p className="text-sm text-muted-foreground">
                      Double-click the{" "}
                      <code className="bg-muted px-1 py-0.5 rounded">.msi</code>{" "}
                      file
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    3.
                  </span>
                  <div>
                    <p className="font-medium">Handle SmartScreen warning</p>
                    <Alert className="mt-2 border-yellow-500/30 bg-yellow-500/10">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <AlertDescription className="text-sm">
                        <strong>Expected warning:</strong> &quot;Windows
                        protected your PC&quot; - this appears because the app
                        is not yet code-signed ($200/year). The software is safe
                        and open source.
                      </AlertDescription>
                    </Alert>
                    <div className="mt-4 bg-muted border border-border rounded-lg p-4">
                      <p className="text-sm font-medium mb-2">To proceed:</p>
                      <ol className="text-sm space-y-1 list-decimal list-inside text-foreground">
                        <li>
                          Click <strong>&quot;More info&quot;</strong> on the
                          SmartScreen dialog
                        </li>
                        <li>
                          Click <strong>&quot;Run anyway&quot;</strong>
                        </li>
                      </ol>
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    4.
                  </span>
                  <div>
                    <p className="font-medium">
                      Follow the installation wizard
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Accept the license and choose installation location
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    5.
                  </span>
                  <div>
                    <p className="font-medium">Launch Qontinui Runner</p>
                    <p className="text-sm text-muted-foreground">
                      Find it in the Start Menu or on your Desktop (if selected)
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="bg-muted border border-border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-3">
                System Requirements
              </h3>
              <ul className="space-y-2 text-sm text-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  Windows 10 or Windows 11
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  64-bit processor
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  4 GB RAM (8 GB recommended)
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  200 MB free disk space
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* macOS Section */}
        <section className="mb-12">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            <span>🍎</span> macOS Installation
          </h2>

          <div className="space-y-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-4">
                Standard Installation
              </h3>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    1.
                  </span>
                  <div>
                    <p className="font-medium">Download the .dmg file</p>
                    <p className="text-sm text-muted-foreground">
                      Universal binary works on Intel and Apple Silicon Macs
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    2.
                  </span>
                  <div>
                    <p className="font-medium">Open the DMG file</p>
                    <p className="text-sm text-muted-foreground">
                      Double-click to mount the disk image
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    3.
                  </span>
                  <div>
                    <p className="font-medium">Drag to Applications</p>
                    <p className="text-sm text-muted-foreground">
                      Drag &quot;Qontinui Runner&quot; to the Applications
                      folder
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    4.
                  </span>
                  <div>
                    <p className="font-medium">
                      First launch (Gatekeeper workaround)
                    </p>
                    <Alert className="mt-2 border-yellow-500/30 bg-yellow-500/10">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <AlertDescription className="text-sm">
                        <strong>Expected:</strong> &quot;Cannot open because
                        developer cannot be verified&quot; - this is because the
                        app is not yet notarized with Apple ($99/year).
                      </AlertDescription>
                    </Alert>
                    <div className="mt-4 bg-muted border border-border rounded-lg p-4">
                      <p className="text-sm font-medium mb-2">
                        Method 1 (Recommended):
                      </p>
                      <ol className="text-sm space-y-1 list-decimal list-inside text-foreground mb-4">
                        <li>Find Qontinui Runner in Applications</li>
                        <li>
                          <strong>Right-click</strong> (or Control-click) on the
                          app
                        </li>
                        <li>
                          Select <strong>&quot;Open&quot;</strong> from the menu
                        </li>
                        <li>
                          Click <strong>&quot;Open&quot;</strong> in the dialog
                        </li>
                        <li>Subsequent launches will work normally</li>
                      </ol>
                      <p className="text-sm font-medium mb-2">
                        Method 2 (Terminal):
                      </p>
                      <div className="bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                        xattr -cr /Applications/Qontinui\ Runner.app
                      </div>
                    </div>
                  </div>
                </li>
              </ol>
            </div>

            <div className="bg-muted border border-border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-3">
                System Requirements
              </h3>
              <ul className="space-y-2 text-sm text-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  macOS 11 (Big Sur) or later
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  Apple Silicon (M1/M2/M3) or Intel processor
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  4 GB RAM (8 GB recommended)
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  200 MB free disk space
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Linux Section */}
        <section className="mb-12">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            <span>🐧</span> Linux Installation
          </h2>

          <div className="space-y-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-4">
                AppImage Installation
              </h3>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    1.
                  </span>
                  <div>
                    <p className="font-medium">Download the AppImage</p>
                    <p className="text-sm text-muted-foreground">
                      Universal format that works on most distros
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    2.
                  </span>
                  <div>
                    <p className="font-medium">Make it executable</p>
                    <div className="mt-2 bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                      chmod +x qontinui-runner-*.AppImage
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    3.
                  </span>
                  <div>
                    <p className="font-medium">Run the AppImage</p>
                    <div className="mt-2 bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                      ./qontinui-runner-*.AppImage
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="font-bold text-primary flex-shrink-0">
                    4.
                  </span>
                  <div>
                    <p className="font-medium">Optional: System Integration</p>
                    <p className="text-sm text-muted-foreground">
                      Install{" "}
                      <a
                        href="https://github.com/TheAssassin/AppImageLauncher"
                        className="text-primary underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        AppImageLauncher
                      </a>{" "}
                      to integrate with your application menu
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            <Alert className="border-primary/30 bg-primary/10">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription>
                <strong>Good news!</strong> Linux doesn&apos;t require code
                signing. No security warnings!
              </AlertDescription>
            </Alert>

            <div className="bg-muted border border-border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-3">
                System Requirements
              </h3>
              <ul className="space-y-2 text-sm text-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  Modern Linux distribution (Ubuntu 20.04+, Fedora 34+, etc.)
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  64-bit processor
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  X11 or Wayland display server
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  4 GB RAM (8 GB recommended)
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  200 MB free disk space
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Verification Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Verifying Your Download</h2>

          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-foreground mb-4">
              For security-conscious users, you can verify the integrity of your
              download using checksums. All releases include SHA-256 checksums
              on GitHub.
            </p>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Windows (PowerShell):</h3>
                <div className="bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                  Get-FileHash qontinui-runner-*.msi -Algorithm SHA256
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">macOS/Linux:</h3>
                <div className="bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                  shasum -a 256 qontinui-runner-*
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Compare the output with the checksum listed on the{" "}
                <Link
                  href="/runner/download"
                  className="text-primary underline"
                >
                  download page
                </Link>{" "}
                or{" "}
                <a
                  href="https://github.com/jspinak/qontinui-runner/releases"
                  className="text-primary underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub releases
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        {/* Troubleshooting */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Troubleshooting</h2>

          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-2">
                Windows: &quot;This app can&apos;t run on your PC&quot;
              </h3>
              <p className="text-sm text-foreground">
                You need a 64-bit version of Windows. Qontinui Runner
                doesn&apos;t support 32-bit systems.
              </p>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-2">
                macOS: &quot;Damaged and can&apos;t be opened&quot;
              </h3>
              <p className="text-sm text-foreground mb-2">
                This happens when macOS quarantines downloaded files. Fix with:
              </p>
              <div className="bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                xattr -cr /Applications/Qontinui\ Runner.app
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-2">
                Linux: &quot;Permission denied&quot;
              </h3>
              <p className="text-sm text-foreground mb-2">
                Make sure the AppImage is executable:
              </p>
              <div className="bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                chmod +x qontinui-runner-*.AppImage
              </div>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Next Steps</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <Link
              href="/docs/getting-started"
              className="bg-primary hover:bg-primary/90 text-primary-foreground p-6 rounded-lg block transition-colors"
            >
              <h3 className="font-semibold mb-2">Getting Started Guide</h3>
              <p className="text-sm opacity-90">
                Learn how to create your first automation
              </p>
            </Link>

            <Link
              href="/docs/runner"
              className="bg-muted hover:bg-muted/80 text-foreground p-6 rounded-lg block transition-colors"
            >
              <h3 className="font-semibold mb-2">Runner Documentation</h3>
              <p className="text-sm text-muted-foreground">
                Complete guide to using Qontinui Runner
              </p>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
