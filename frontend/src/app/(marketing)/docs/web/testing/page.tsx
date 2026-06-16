import Link from "next/link";
import {
  FlaskConical,
  Zap,
  GitBranch,
  Clock,
  Database,
  CheckCircle2,
  AlertCircle,
  Box,
} from "lucide-react";

export const metadata = {
  title: "Mock Testing - Qontinui Web Documentation",
  description:
    "Test your automation logic deterministically with Qontinui's mock mode — run state machines and actions against recorded results instead of a live GUI.",
};

export default function MockTestingDocPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/web"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Qontinui Web Docs
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Mock Testing
          </h1>
          <p className="text-xl text-muted-foreground">
            Verify your state-machine logic without a live GUI — fast,
            deterministic, and CI-friendly
          </p>
        </div>

        {/* What is Mock Testing */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What is Mock Testing?
          </h2>
          <p className="text-foreground mb-4">
            <strong>Mock mode</strong> runs your automation against{" "}
            <em>simulated</em> state and match results instead of capturing the
            real screen. The action layer is completely unchanged — actions like{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              Find
            </code>
            ,{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              Click
            </code>
            , and{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              Type
            </code>{" "}
            execute exactly as they would in production, but the matches they
            receive come from recorded history rather than live image
            recognition.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: Same Code Path, Simulated Inputs
            </h3>
            <p className="text-sm text-foreground">
              Qontinui (descended from Brobot) uses the{" "}
              <strong>same Match objects</strong> for both mock and real
              automation — there is no separate &quot;test type.&quot; The mock
              find implementation returns results in the identical format as the
              real one, so the logic you verify in mock mode is the same logic
              that runs against the real GUI.
            </p>
          </div>

          <p className="text-foreground">
            This lets you exercise the structure of your automation — which
            states are reached, which transitions fire, in what order — without
            needing the target application open, a particular screen resolution,
            or even a display at all.
          </p>
        </section>

        {/* Why it Matters */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Why Mock Testing Matters
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <BenefitCard
              icon={<Zap className="w-6 h-6 text-primary" />}
              title="Fast"
              description="No screen capture, no template matching, no real waits. Mock time elapses instantly, so a workflow that takes minutes against a live GUI completes in milliseconds."
            />
            <BenefitCard
              icon={<GitBranch className="w-6 h-6 text-green-600" />}
              title="Deterministic"
              description="Recorded match results are replayed identically every run. The same inputs always produce the same path through your state machine — no flaky pixels."
            />
            <BenefitCard
              icon={<FlaskConical className="w-6 h-6 text-purple-600" />}
              title="CI-Friendly"
              description="Because no display is required, mock runs work in headless CI environments. Catch broken transitions and unreachable states before deploying to a real machine."
            />
            <BenefitCard
              icon={<Box className="w-6 h-6 text-primary" />}
              title="Logic-Focused"
              description="Separate state-machine correctness from image-recognition tuning. Verify your flow first, then refine similarity thresholds against the real screen."
            />
          </div>
        </section>

        {/* How it Works */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            How Mock Mode Works
          </h2>

          <p className="text-foreground mb-6">
            When mock mode is enabled, Qontinui swaps its execution backend.
            Each of the three execution modes routes actions differently:
          </p>

          <div className="space-y-4">
            <ModeCard
              icon={<Box className="w-5 h-5 text-primary" />}
              title="Real"
              description="Full automation through the hardware abstraction layer — live screen capture plus OpenCV template matching. This is the default for production runs."
            />
            <ModeCard
              icon={<Database className="w-5 h-5 text-purple-600" />}
              title="Mock"
              description="Historical-data playback. Find requests are answered from recorded matches instead of the screen, and timed waits resolve instantly."
            />
            <ModeCard
              icon={<FlaskConical className="w-5 h-5 text-green-600" />}
              title="Screenshot"
              description="Matching runs against captured screenshots rather than the live display — useful for reproducing a recorded scene deterministically."
            />
          </div>

          <div className="bg-muted border border-border rounded-lg p-6 mt-6">
            <h3 className="font-semibold text-foreground mb-4">
              Where Mock Matches Come From
            </h3>
            <p className="text-sm text-foreground mb-4">
              In mock mode, a find action resolves matches in priority order:
            </p>
            <ol className="space-y-3">
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">
                  1
                </span>
                <div>
                  <strong className="text-foreground">
                    Recorded Action History
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    Pre-recorded results attached to a pattern (fastest path —
                    no external lookup)
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">
                  2
                </span>
                <div>
                  <strong className="text-foreground">Historical Data</strong>
                  <p className="text-sm text-muted-foreground">
                    Previously captured results from the local database, if
                    available
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">
                  3
                </span>
                <div>
                  <strong className="text-foreground">
                    Probabilistic Fallback
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    A generated mock match based on state probability when no
                    recorded data exists
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* Action Snapshots */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Action Snapshots
          </h2>

          <p className="text-foreground mb-6">
            The raw material for mock playback is the{" "}
            <strong>action snapshot</strong> — a historical record of a single
            action execution. Each record captures everything needed to replay
            the action deterministically:
          </p>

          <div className="grid gap-4">
            <SnapshotField
              icon={<Box className="w-5 h-5 text-primary" />}
              title="Action Type & Result"
              description="What was performed (FIND, CLICK, TYPE…) and whether it succeeded"
            />
            <SnapshotField
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Match List"
              description="The actual Match objects found — the same type used for real matches"
            />
            <SnapshotField
              icon={<Box className="w-5 h-5 text-purple-600" />}
              title="Active States"
              description="Which states were active when the action ran, so playback respects context"
            />
            <SnapshotField
              icon={<Clock className="w-5 h-5 text-yellow-600" />}
              title="Duration & Timestamp"
              description="Timing metadata used to model elapsed time without real waiting"
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> Snapshots store real{" "}
                <code className="font-mono bg-muted border border-border px-1 rounded">
                  Match
                </code>{" "}
                objects — there is no separate snapshot type. This mirrors
                Brobot&apos;s design and is why mock and real runs share one code
                path.
              </p>
            </div>
          </div>
        </section>

        {/* Enabling Mock Mode */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Enabling Mock Mode
          </h2>

          <p className="text-foreground mb-6">
            Mock mode is a single global switch with a few equivalent ways to
            set it:
          </p>

          <div className="space-y-4">
            <ToggleCard
              title="Configuration Setting"
              description="Set the execution mode to mock in your exported configuration's execution settings."
              code='"execution": { "executionMode": "mock" }'
            />
            <ToggleCard
              title="Environment Variable"
              description="Set the mock-mode environment variable before running — accepts true / 1 / yes / on."
              code="QONTINUI_MOCK_MODE=true"
            />
            <ToggleCard
              title="Test Environment (Automatic)"
              description="Mock mode turns on automatically when running under a test runner, so unit tests never touch the real screen."
              code="(auto-enabled under pytest)"
            />
          </div>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mt-6">
            <p className="text-sm text-foreground">
              <strong>Browser Mock Execution:</strong> Qontinui Web can run your
              automation logic directly in the browser without a real GUI
              environment — ideal for rapid iteration while you build a workflow
              in the visual editor.
            </p>
          </div>
        </section>

        {/* Recommended Workflow */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Recommended Workflow
          </h2>

          <div className="space-y-6">
            <StepCard
              number={1}
              title="Build Your State Machine"
              description="Define states, identifying images, and transitions in the visual builder."
            />
            <StepCard
              number={2}
              title="Run in Mock Mode"
              description="Execute the automation with mock mode enabled to confirm the intended states are reached and transitions fire in the right order."
            />
            <StepCard
              number={3}
              title="Fix Logic Issues"
              description="Resolve unreachable states, missing transitions, or wrong action ordering — all without touching the real application."
            />
            <StepCard
              number={4}
              title="Switch to Real Mode"
              description="Once the logic is sound, run against the live GUI and tune similarity thresholds for reliable image recognition."
            />
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Working with States"
              description="Define the states your mock runs will move between"
              href="/docs/web/states"
            />
            <NextStepCard
              title="State Transitions"
              description="Connect states and verify the flow in mock mode"
              href="/docs/web/transitions"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface BenefitCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function BenefitCard({ icon, title, description }: BenefitCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h3 className="font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function ModeCard({ icon, title, description }: ModeCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-foreground mb-1">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

interface SnapshotFieldProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function SnapshotField({ icon, title, description }: SnapshotFieldProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-foreground mb-1">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

interface ToggleCardProps {
  title: string;
  description: string;
  code: string;
}

function ToggleCard({ title, description, code }: ToggleCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <h4 className="font-semibold text-foreground mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>
      <code className="block font-mono text-xs bg-background border border-border px-3 py-2 rounded text-foreground">
        {code}
      </code>
    </div>
  );
}

interface StepCardProps {
  number: number;
  title: string;
  description: string;
}

function StepCard({ number, title, description }: StepCardProps) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-foreground">{description}</p>
      </div>
    </div>
  );
}

interface NextStepCardProps {
  title: string;
  description: string;
  href: string;
}

function NextStepCard({ title, description, href }: NextStepCardProps) {
  return (
    <Link
      href={href}
      className="block bg-muted border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
