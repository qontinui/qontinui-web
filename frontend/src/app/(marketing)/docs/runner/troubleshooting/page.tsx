import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  XCircle,
  Settings,
  Monitor,
  HardDrive,
  Lock,
  AlertTriangle,
  Zap,
  Code,
} from "lucide-react";

export const metadata = {
  title: "Troubleshooting - Qontinui Runner Documentation",
  description:
    "Common issues, error messages, and solutions for Qontinui Runner including installation problems, execution errors, and performance issues.",
};

export default function TroubleshootingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/runner"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            &larr; Back to Runner Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Troubleshooting
          </h1>
          <p className="text-xl text-muted-foreground">
            Common issues and solutions for Qontinui Runner
          </p>
        </div>

        {/* Quick Diagnostics */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Quick Diagnostics
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <DiagnosticCard
              icon={<CheckCircle2 className="w-6 h-6 text-green-600" />}
              title="Check Logs"
              description="Console output shows detailed error messages and stack traces"
            />
            <DiagnosticCard
              icon={<Monitor className="w-6 h-6 text-primary" />}
              title="Verify Display"
              description="Ensure target application is visible on the correct monitor"
            />
            <DiagnosticCard
              icon={<HardDrive className="w-6 h-6 text-purple-600" />}
              title="Check Permissions"
              description="Runner needs screen capture and input control permissions"
            />
            <DiagnosticCard
              icon={<Settings className="w-6 h-6 text-orange-600" />}
              title="Validate Config"
              description="Ensure JSON configuration is valid and complete"
            />
          </div>
        </section>

        {/* Installation Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <HardDrive className="w-7 h-7 text-red-600" />
            Installation Issues
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              severity="error"
              problem="Windows: SmartScreen blocks installation"
              errorCode="INSTALL_001"
              symptoms={[
                "Windows protected your PC warning appears",
                "Installer won&apos;t run or gets blocked",
              ]}
              solutions={[
                "Click More info on the SmartScreen dialog",
                "Click Run anyway to proceed with installation",
                "This is expected - the app is not yet code-signed ($200/year cost)",
                "The software is safe and open source",
              ]}
              relatedDocs="/docs/runner/installation"
            />

            <TroubleshootingCard
              severity="error"
              problem="Windows: Missing WebView2 Runtime (Development mode)"
              errorCode="INSTALL_002"
              symptoms={[
                "App won&apos;t launch after installation",
                "Error message mentions WebView2 or browser components",
              ]}
              solutions={[
                "Download WebView2 Runtime from Microsoft: https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                "Run the installer",
                "Restart Qontinui Runner",
                "Note: Production .msi bundles WebView2, this only affects dev builds",
              ]}
            />

            <TroubleshootingCard
              severity="error"
              problem="macOS: App is damaged and cannot be opened"
              errorCode="INSTALL_003"
              symptoms={[
                "Error when trying to open the app after installation",
                "Gatekeeper shows damaged warning",
              ]}
              solutions={[
                "This is Gatekeeper blocking unsigned apps",
                "Right-click (or Control+click) the app icon",
                "Select Open from the context menu",
                "Click Open in the confirmation dialog",
                "You only need to do this once per installation",
              ]}
              relatedDocs="/docs/runner/installation"
            />

            <TroubleshootingCard
              severity="warning"
              problem="Linux: Permission denied when running AppImage"
              errorCode="INSTALL_004"
              symptoms={[
                "AppImage won&apos;t execute",
                "Permission denied error in terminal",
              ]}
              solutions={[
                "Make the AppImage executable: chmod +x qontinui-runner.AppImage",
                "Run the AppImage: ./qontinui-runner.AppImage",
                "Alternatively, right-click > Properties > Permissions > Allow executing as program",
              ]}
            />

            <TroubleshootingCard
              severity="error"
              problem="Linux: Missing dependencies for AppImage"
              errorCode="INSTALL_005"
              symptoms={[
                "AppImage fails to start with dependency errors",
                "Error mentions missing FUSE or libraries",
              ]}
              solutions={[
                "Install FUSE: sudo apt install fuse libfuse2 (Ubuntu/Debian)",
                "Or: sudo dnf install fuse fuse-libs (Fedora)",
                "Install X11 libraries if missing: sudo apt install libx11-6 libxcb1",
                "For Wayland users: Ensure XWayland is installed",
              ]}
            />
          </div>
        </section>

        {/* Connection Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Lock className="w-7 h-7 text-yellow-600" />
            Connection Issues
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              severity="error"
              problem="Unable to connect to Qontinui Web"
              errorCode="CONN_001"
              symptoms={[
                "Connection failed when trying to log in",
                "Runner can&apos;t fetch projects or configurations",
                "Authentication errors",
              ]}
              solutions={[
                "Check your internet connection",
                "Verify Qontinui Web is accessible in your browser: https://app.qontinui.io",
                "Try logging out and back in",
                "Check firewall settings - Runner needs HTTPS access",
                "If using corporate network, ensure WebSockets are allowed",
              ]}
            />

            <TroubleshootingCard
              severity="error"
              problem="Authentication tokens not persisting"
              errorCode="CONN_002"
              symptoms={[
                "Runner asks you to log in every time you open it",
                "Session doesn&apos;t persist between launches",
              ]}
              solutions={[
                "Windows: Check Windows Credential Manager access",
                "macOS: Verify Keychain Access permissions for Qontinui Runner",
                "Linux: Ensure Secret Service (libsecret) is installed and running",
                "Try logging out, restarting the app, and logging in again",
              ]}
              technicalDetails={{
                title: "Token Storage",
                details: [
                  "Tokens stored in OS keychain: Windows Credential Manager, macOS Keychain, Linux Secret Service",
                  "Service name: com.qontinui.runner",
                  "Check if other apps using keychain work correctly",
                ],
              }}
            />

            <TroubleshootingCard
              severity="warning"
              problem="Device registration issues"
              errorCode="CONN_003"
              symptoms={[
                "Device not registered error",
                "Can't connect desktop runner to project",
              ]}
              solutions={[
                "Ensure you've selected a project in Qontinui Web before connecting",
                "Copy the connection string from Connect Desktop Runner page",
                "Paste the full connection string into Runner",
                "Check that your account has permission to access the project",
                "Try regenerating the connection string if it&apos;s old",
              ]}
              relatedDocs="/docs/runner/execution"
            />
          </div>
        </section>

        {/* Execution Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Zap className="w-7 h-7 text-orange-600" />
            Execution Issues
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              severity="error"
              problem="Python executor fails to start"
              errorCode="EXEC_001"
              symptoms={[
                "Executor error in logs",
                "Failed to start Python process",
                "Runner appears frozen after loading config",
              ]}
              solutions={[
                "Check Python 3.10+ is installed: python --version",
                "Verify qontinui library is installed: pip show qontinui",
                "Check logs for Python stack traces",
                "Ensure no antivirus is blocking Python subprocess execution",
                "Try restarting Runner completely",
              ]}
              technicalDetails={{
                title: "Python Bridge",
                details: [
                  "Runner spawns Python subprocess to execute automation",
                  "Communication via stdin/stdout using JSON protocol",
                  "Check .dev-logs/ for detailed Python output (dev mode)",
                ],
              }}
            />

            <TroubleshootingCard
              severity="error"
              problem="Initial state not found"
              errorCode="EXEC_002"
              symptoms={[
                "Execution stops immediately after starting",
                "No initial state detected or Initial state not active",
              ]}
              solutions={[
                "Verify at least one state has is_initial: true in your config",
                "Check that the target application is in the expected initial state",
                "Ensure initial state's identifying images match the current screen",
                "Lower similarity thresholds if images aren't being recognized (try 0.8 instead of 0.9)",
                "Use Find action to test image recognition before running workflow",
              ]}
              relatedDocs="/docs/runner/execution"
            />

            <TroubleshootingCard
              severity="warning"
              problem="Actions timing out repeatedly"
              errorCode="EXEC_003"
              symptoms={[
                "Actions fail with timeout errors",
                "Workflow execution is extremely slow",
                "Many retry attempts in logs",
              ]}
              solutions={[
                "Increase default_timeout in config (try 15000ms for slow apps)",
                "Add action_delay between actions to give UI time to respond (try 200-500ms)",
                "Check if target app is waiting for user input or has modal dialogs",
                "Look for loading animations or spinners that may be blocking interactions",
                "Verify the app isn&apos;t frozen or unresponsive",
              ]}
              technicalDetails={{
                title: "Timeout Configuration",
                details: [
                  "default_timeout: Max time to wait for actions (default 10000ms)",
                  "default_retry_count: Number of retry attempts (default 3)",
                  "action_delay: Delay between actions (default 100ms)",
                ],
              }}
            />

            <TroubleshootingCard
              severity="warning"
              problem="Image recognition failing: Image not found on screen"
              errorCode="EXEC_004"
              symptoms={[
                "FIND actions repeatedly fail",
                "CLICK actions can&apos;t locate elements",
                "Low similarity scores in logs",
              ]}
              solutions={[
                "Verify the image is actually visible on the current screen",
                "Lower similarity threshold (0.8 or 0.75 instead of 0.9)",
                "Recapture the image if the UI has changed",
                "Check if image is outside the search region",
                "Enable multi-scale search if screen resolution differs from capture",
                "Look for overlapping windows or notifications covering the element",
                "Verify correct monitor is selected for multi-monitor setups",
              ]}
              relatedDocs="/docs/web/image-recognition"
            />

            <TroubleshootingCard
              severity="error"
              problem="State machine stuck: No applicable transitions found"
              errorCode="EXEC_005"
              symptoms={[
                "Workflow stops mid-execution",
                "No transitions are triggered from current state",
                "State machine appears frozen",
              ]}
              solutions={[
                "Check that the current state has outgoing transitions defined",
                "Verify transition conditions/triggers are met",
                "Ensure to_state exists and is reachable",
                "Review state history in logs to see how automation arrived here",
                "Add error recovery transitions for common failure states",
                "Use continue_on_error for actions that may fail",
              ]}
            />

            <TroubleshootingCard
              severity="warning"
              problem="Execution too slow or hanging"
              errorCode="EXEC_006"
              symptoms={[
                "Workflow takes much longer than expected",
                "Runner appears to hang between actions",
                "High CPU usage during execution",
              ]}
              solutions={[
                "Reduce default_retry_count if not needed (try 1 or 2 instead of 3)",
                "Decrease action_delay for faster execution (try 50ms)",
                "Use search regions to limit image search areas",
                "Disable multi-scale search if not needed",
                "Check for infinite loops in state transitions",
                "Review process complexity - break into smaller steps",
                "Ensure no background processes are competing for resources",
              ]}
            />

            <TroubleshootingCard
              severity="error"
              problem="Configuration validation errors"
              errorCode="EXEC_007"
              symptoms={[
                "Config fails to load with validation errors",
                "Missing images, invalid state references",
                "Malformed processes or actions",
              ]}
              solutions={[
                "Check console output for specific validation errors",
                "Verify all referenced states exist in the configuration",
                "Ensure all image files are embedded or accessible",
                "Check JSON syntax is valid (no trailing commas, etc.)",
                "Verify action types are correct (CLICK, FIND, TYPE, etc.)",
                "Test config in Qontinui Web mock execution first",
              ]}
            />
          </div>
        </section>

        {/* Performance Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <AlertTriangle className="w-7 h-7 text-amber-600" />
            Performance Issues
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              severity="warning"
              problem="High CPU usage during execution"
              errorCode="PERF_001"
              symptoms={[
                "CPU usage spikes to 80-100%",
                "System becomes sluggish",
                "Fan noise increases significantly",
              ]}
              solutions={[
                "Use search regions to reduce image search area",
                "Disable multi-scale matching if not needed",
                "Increase action_delay to reduce polling frequency",
                "Close other resource-intensive applications",
                "Check if antivirus is scanning Python/Runner processes",
                "Consider upgrading hardware for complex automations",
              ]}
            />

            <TroubleshootingCard
              severity="warning"
              problem="High memory usage"
              errorCode="PERF_002"
              symptoms={[
                "RAM usage climbs over time",
                "System runs out of memory",
                "Runner crashes after long executions",
              ]}
              solutions={[
                "Restart Runner between long workflow executions",
                "Clear screenshot capture directory periodically",
                "Reduce number of images in configuration",
                "Check for memory leaks in custom actions",
                "Close unnecessary applications to free RAM",
              ]}
            />

            <TroubleshootingCard
              severity="info"
              problem="Slow startup time"
              errorCode="PERF_003"
              symptoms={[
                "Runner takes 10+ seconds to open",
                "Loading screen appears for extended time",
              ]}
              solutions={[
                "This is normal - Python executor initialization takes time",
                "Ensure SSD is used for Runner installation (not HDD)",
                "Check for antivirus scanning delaying startup",
                "Close other applications using Python interpreters",
              ]}
            />
          </div>
        </section>

        {/* Platform-Specific Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Monitor className="w-7 h-7 text-primary" />
            Platform-Specific Issues
          </h2>

          <div className="space-y-6">
            <PlatformCard
              platform="Windows"
              issues={[
                {
                  problem: "Screen capture permissions denied",
                  solution:
                    "Go to Settings > Privacy > Screenshots and apps. Allow Qontinui Runner.",
                },
                {
                  problem: "Input control not working",
                  solution:
                    "Run Runner as administrator (right-click > Run as administrator) if automating elevated apps.",
                },
                {
                  problem: "WebView2 Runtime not found",
                  solution:
                    "Download from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and install.",
                },
              ]}
            />

            <PlatformCard
              platform="macOS"
              issues={[
                {
                  problem: "Screen recording permission denied",
                  solution:
                    "System Preferences > Security & Privacy > Privacy > Screen Recording. Check Qontinui Runner.",
                },
                {
                  problem: "Accessibility permission denied",
                  solution:
                    "System Preferences > Security & Privacy > Privacy > Accessibility. Add Qontinui Runner.",
                },
                {
                  problem: "App won&apos;t open on Apple Silicon",
                  solution:
                    "Download the universal binary .dmg. Right-click > Open first time.",
                },
              ]}
            />

            <PlatformCard
              platform="Linux"
              issues={[
                {
                  problem: "X11 display errors",
                  solution:
                    "Ensure DISPLAY environment variable is set. Try: export DISPLAY=:0",
                },
                {
                  problem: "Wayland compatibility issues",
                  solution:
                    "Install XWayland: sudo apt install xwayland. Some features may require X11.",
                },
                {
                  problem: "libfuse2 not found",
                  solution:
                    "Install FUSE: sudo apt install fuse libfuse2 (Ubuntu/Debian)",
                },
              ]}
            />
          </div>
        </section>

        {/* Error Codes Reference */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Code className="w-7 h-7 text-muted-foreground" />
            Error Codes Reference
          </h2>

          <div className="bg-muted border border-border rounded-lg p-6">
            <p className="text-sm text-foreground mb-4">
              Runner uses structured error codes for easier debugging. Look for
              these in console logs:
            </p>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <ErrorCodeItem code="CONFIG_001" meaning="Configuration Error" />
              <ErrorCodeItem code="EXEC_001" meaning="Executor Error" />
              <ErrorCodeItem code="IO_001" meaning="File System Error" />
              <ErrorCodeItem
                code="JSON_001"
                meaning="Data Format/Parse Error"
              />
              <ErrorCodeItem code="PROC_001" meaning="Process Error" />
              <ErrorCodeItem code="COMM_001" meaning="Communication Error" />
              <ErrorCodeItem code="STATE_001" meaning="Invalid State Error" />
              <ErrorCodeItem code="VAL_001" meaning="Validation Error" />
              <ErrorCodeItem code="TIME_001" meaning="Timeout Error" />
              <ErrorCodeItem code="HEALTH_001" meaning="Health Check Error" />
            </div>
          </div>
        </section>

        {/* Advanced Debugging */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Advanced Debugging
          </h2>

          <div className="space-y-4">
            <DebugTechnique
              title="Enable Verbose Logging"
              steps={[
                "Open Runner settings",
                "Enable Debug Mode or Verbose Logging",
                "Restart execution and check console output",
                "Look for detailed action logs and image recognition scores",
              ]}
            />

            <DebugTechnique
              title="Capture Execution Screenshots"
              steps={[
                "Enable Screenshot Capture in settings",
                "Run your automation workflow",
                "Check the screenshots folder for before/after action images",
                "Review screenshots to see exactly what the automation saw",
              ]}
            />

            <DebugTechnique
              title="Test Individual Actions"
              steps={[
                "Use Run Specific Process mode instead of full workflow",
                "Test each action in isolation",
                "Verify image recognition with FIND before using CLICK",
                "Check action parameters and timing",
              ]}
            />

            <DebugTechnique
              title="Review Python Logs (Development)"
              steps={[
                "Check .dev-logs/runner-backend.log for Rust/Python errors",
                "Check .dev-logs/qontinui-lib.log for library-level logs",
                "Look for stack traces and Python exceptions",
                "Verify Python subprocess is communicating correctly",
              ]}
            />
          </div>
        </section>

        {/* Still Having Issues */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Still Having Issues?
          </h2>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-8">
            <p className="text-foreground mb-6">
              If you&apos;ve tried the solutions above and still need help:
            </p>

            <div className="space-y-4">
              <SupportOption
                title="Check Documentation"
                description="Review other Runner documentation sections for detailed guides"
                link="/docs/runner"
                linkText="Runner Documentation"
              />

              <SupportOption
                title="Community Support"
                description="Ask questions and get help from the Qontinui community"
                link="https://github.com/qontinui/qontinui/discussions"
                linkText="GitHub Discussions"
                external
              />

              <SupportOption
                title="Report a Bug"
                description="Found a bug? Report it on GitHub with logs and reproduction steps"
                link="https://github.com/qontinui/qontinui/issues"
                linkText="Create Issue"
                external
              />

              <SupportOption
                title="Contact Support"
                description="Need direct assistance? Reach out to our support team"
                link="mailto:support@qontinui.io"
                linkText="support@qontinui.io"
              />
            </div>
          </div>

          <div className="mt-6 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-sm text-foreground">
              <strong>When reporting issues:</strong> Include your OS version,
              Runner version, error codes from logs, and steps to reproduce.
              This helps us fix problems faster.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

interface DiagnosticCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function DiagnosticCard({ icon, title, description }: DiagnosticCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-start gap-3">
      <div className="flex-shrink-0 mt-1">{icon}</div>
      <div>
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

interface TroubleshootingCardProps {
  severity: "error" | "warning" | "info";
  problem: string;
  errorCode: string;
  symptoms: string[];
  solutions: string[];
  relatedDocs?: string;
  technicalDetails?: {
    title: string;
    details: string[];
  };
}

function TroubleshootingCard({
  severity,
  problem,
  errorCode,
  symptoms,
  solutions,
  relatedDocs,
  technicalDetails,
}: TroubleshootingCardProps) {
  const severityConfig = {
    error: {
      icon: <XCircle className="w-5 h-5 text-red-600" />,
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/30",
      textColor: "text-foreground",
      badgeColor: "bg-red-100 text-red-800",
    },
    warning: {
      icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
      bgColor: "bg-yellow-500/10",
      borderColor: "border-yellow-500/30",
      textColor: "text-foreground",
      badgeColor: "bg-amber-100 text-amber-800",
    },
    info: {
      icon: <AlertCircle className="w-5 h-5 text-primary" />,
      bgColor: "bg-primary/10",
      borderColor: "border-primary/30",
      textColor: "text-foreground",
      badgeColor: "bg-blue-100 text-blue-800",
    },
  };

  const config = severityConfig[severity];

  return (
    <div
      className={`${config.bgColor} border ${config.borderColor} rounded-lg p-6`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-shrink-0 mt-0.5">{config.icon}</div>
        <div className="flex-grow">
          <div className="flex items-start justify-between gap-4 mb-2">
            <h3 className={`font-semibold ${config.textColor}`}>{problem}</h3>
            <span
              className={`text-xs font-mono px-2 py-1 rounded ${config.badgeColor} flex-shrink-0`}
            >
              {errorCode}
            </span>
          </div>

          {/* Symptoms */}
          <div className="mb-4">
            <p className={`text-xs font-semibold ${config.textColor} mb-2`}>
              Symptoms:
            </p>
            <ul className="space-y-1">
              {symptoms.map((symptom, idx) => (
                <li
                  key={idx}
                  className={`flex items-start gap-2 text-sm ${config.textColor}`}
                >
                  <span className="flex-shrink-0">•</span>
                  <span>{symptom}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Solutions */}
          <div className="mb-4">
            <p className={`text-xs font-semibold ${config.textColor} mb-2`}>
              Solutions:
            </p>
            <ol className="space-y-2">
              {solutions.map((solution, idx) => (
                <li
                  key={idx}
                  className={`flex items-start gap-2 text-sm ${config.textColor}`}
                >
                  <span className="font-semibold flex-shrink-0">
                    {idx + 1}.
                  </span>
                  <span>{solution}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Technical Details */}
          {technicalDetails && (
            <div className="mb-4 bg-background/50 border border-border rounded p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                {technicalDetails.title}
              </p>
              <ul className="space-y-1">
                {technicalDetails.details.map((detail, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span>•</span>
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Related Documentation */}
          {relatedDocs && (
            <Link
              href={relatedDocs}
              className="inline-block text-sm font-semibold text-primary hover:text-primary/80 underline"
            >
              Related Documentation &rarr;
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlatformCardProps {
  platform: string;
  issues: Array<{
    problem: string;
    solution: string;
  }>;
}

function PlatformCard({ platform, issues }: PlatformCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h3 className="text-lg font-bold text-foreground mb-4">{platform}</h3>
      <div className="space-y-4">
        {issues.map((issue, idx) => (
          <div key={idx} className="border-l-4 border-primary pl-4">
            <p className="font-semibold text-foreground mb-1">
              {issue.problem}
            </p>
            <p className="text-sm text-foreground">{issue.solution}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ErrorCodeItemProps {
  code: string;
  meaning: string;
}

function ErrorCodeItem({ code, meaning }: ErrorCodeItemProps) {
  return (
    <div className="flex items-center gap-2">
      <code className="bg-muted px-2 py-1 rounded font-mono text-xs font-semibold text-foreground">
        {code}
      </code>
      <span className="text-foreground">{meaning}</span>
    </div>
  );
}

interface DebugTechniqueProps {
  title: string;
  steps: string[];
}

function DebugTechnique({ title, steps }: DebugTechniqueProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-5">
      <h3 className="font-semibold text-foreground mb-3">{title}</h3>
      <ol className="space-y-2">
        {steps.map((step, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <span className="font-semibold text-primary">{idx + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface SupportOptionProps {
  title: string;
  description: string;
  link: string;
  linkText: string;
  external?: boolean;
}

function SupportOption({
  title,
  description,
  link,
  linkText,
  external,
}: SupportOptionProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-2">{description}</p>
      <Link
        href={link}
        className="inline-block text-sm font-semibold text-primary hover:text-primary/80 underline"
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {linkText} {external && "↗"}
      </Link>
    </div>
  );
}
