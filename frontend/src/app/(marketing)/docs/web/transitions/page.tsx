import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export const metadata = {
  title: "State Transitions - Qontinui Web Documentation",
  description:
    "Learn how to connect states with transitions in Qontinui for model-based GUI automation.",
};

export default function TransitionsDocPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/web"
            className="text-blue-600 hover:text-blue-700 text-sm mb-4 inline-block"
          >
            ← Back to Qontinui Web Docs
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            State Transitions
          </h1>
          <p className="text-xl text-slate-600">
            Connect states and define automation workflows with transitions
          </p>
        </div>

        {/* What is a Transition */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            What is a Transition?
          </h2>
          <p className="text-slate-700 mb-4">
            A <strong>Transition</strong> is a connection between two states
            that defines how automation moves from one state to another.
            Transitions are the edges in your state machine graph, while states
            are the nodes.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-blue-900 mb-3">
              Key Concept: Transitions = Navigation Logic
            </h3>
            <p className="text-sm text-blue-900">
              Each transition defines <strong>what actions to perform</strong>{" "}
              (via a process) and{" "}
              <strong>which states become active/inactive</strong> after the
              transition completes. This gives you fine-grained control over
              your automation workflow.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold text-slate-900 mb-3">
              How Transitions Work
            </h3>
            <ol className="space-y-3 text-sm text-slate-700">
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">1.</span>
                <span>
                  Automation is in the source state (e.g., "Login Screen")
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">2.</span>
                <span>
                  Transition's process executes (e.g., type username, click
                  submit)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">3.</span>
                <span>
                  Destination state becomes active (e.g., "Dashboard")
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">4.</span>
                <span>
                  Source state deactivates (unless stays_visible is true)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-blue-600">5.</span>
                <span>Additional states activate/deactivate as specified</span>
              </li>
            </ol>
          </div>
        </section>

        {/* Transition Types */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Types of Transitions
          </h2>

          <div className="space-y-6">
            <TransitionTypeCard
              icon={<ArrowRight className="w-6 h-6 text-blue-600" />}
              title="Outgoing Transition"
              description="Defines navigation FROM one state TO another state"
              details={[
                "Specifies source state (from_state) and destination state (to_state)",
                "Executes a process containing actions to perform",
                "Controls which states become active/inactive after transition",
                "Most common transition type for state navigation",
              ]}
              example={{
                title: "Example: Login to Dashboard",
                description:
                  "from_state: 'Login Screen' → to_state: 'Dashboard'",
                process: "Process: Type credentials, click submit button",
              }}
            />

            <TransitionTypeCard
              icon={<CheckCircle2 className="w-6 h-6 text-green-600" />}
              title="Incoming Transition"
              description="Verification or setup when ENTERING a state"
              details={[
                "Executes after a state becomes active",
                "Used for verification, waiting, or initialization",
                "Doesn't change which states are active",
                "Ensures state is fully ready before continuing",
              ]}
              example={{
                title: "Example: Dashboard Load Verification",
                description: "to_state: 'Dashboard'",
                process:
                  "Process: Wait for loading spinner to vanish, verify welcome message",
              }}
            />
          </div>
        </section>

        {/* Creating Transitions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Creating a Transition
          </h2>

          <div className="space-y-6">
            <StepCard
              number={1}
              title="Select Source and Destination States"
              description="In the state diagram, click and drag from the source state to the destination state to create a transition arrow."
            />

            <StepCard
              number={2}
              title="Configure the Transition"
              description="Click the transition arrow to open its properties panel."
            />

            <StepCard
              number={3}
              title="Assign a Process"
              description="Select or create a process that contains the actions to perform during this transition (e.g., 'login_process', 'click_submit_button')."
            />

            <StepCard
              number={4}
              title="Set State Visibility Options"
              description="Configure whether the source state stays visible and which additional states to activate/deactivate."
            />
          </div>
        </section>

        {/* Transition Properties */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Transition Properties
          </h2>

          <div className="space-y-4">
            <PropertyCard
              name="from_state"
              type="State ID"
              description="Source state where this transition originates. Only applies to Outgoing Transitions."
              isRequired
            />

            <PropertyCard
              name="to_state"
              type="State ID"
              description="Destination state where this transition leads."
              isRequired
            />

            <PropertyCard
              name="process"
              type="Process ID"
              description="ID of the process containing actions to execute during this transition. Can be empty for state-change-only transitions."
            />

            <PropertyCard
              name="stays_visible"
              type="Boolean"
              description="If true, the source state remains active after transition. Use this for dialogs or overlays that appear over existing screens."
              defaultValue="false"
            />

            <PropertyCard
              name="activate_states"
              type="List of State IDs"
              description="Additional states to activate after the transition completes. Useful for parallel states that should appear alongside the destination state."
              defaultValue="[]"
            />

            <PropertyCard
              name="deactivate_states"
              type="List of State IDs"
              description="States to deactivate after the transition completes. Useful for explicitly closing parallel states."
              defaultValue="[]"
            />

            <PropertyCard
              name="timeout"
              type="Integer (milliseconds)"
              description="Maximum time to wait for transition completion."
              defaultValue="10000"
            />

            <PropertyCard
              name="retry_count"
              type="Integer"
              description="Number of retry attempts if transition fails."
              defaultValue="3"
            />
          </div>
        </section>

        {/* Parallel States & Visibility */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Managing Parallel States
          </h2>

          <p className="text-slate-700 mb-6">
            Qontinui supports multiple states being active simultaneously. This
            is useful for scenarios like dialog boxes appearing over background
            screens, or multi-panel UIs with independent sections.
          </p>

          <div className="space-y-6">
            <ParallelStateExample
              title="Scenario 1: Dialog Over Background"
              description="Opening a settings dialog while keeping the dashboard visible"
              config={{
                from_state: "Dashboard",
                to_state: "Settings Dialog",
                stays_visible: true,
                process: "click_settings_button",
              }}
              result="Both Dashboard and Settings Dialog are active"
            />

            <ParallelStateExample
              title="Scenario 2: Multi-State Activation"
              description="Opening a sidebar and toolbar alongside the main content"
              config={{
                from_state: "Main Content",
                to_state: "Editor View",
                activate_states: ["Sidebar", "Toolbar"],
                process: "initialize_editor",
              }}
              result="Editor View, Sidebar, and Toolbar are all active"
            />

            <ParallelStateExample
              title="Scenario 3: Closing Parallel States"
              description="Closing all dialogs and returning to main screen"
              config={{
                from_state: "Settings Dialog",
                to_state: "Dashboard",
                deactivate_states: ["Error Toast", "Notification Panel"],
                process: "click_close_button",
              }}
              result="Only Dashboard is active, all dialogs closed"
            />
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Best Practices
          </h2>

          <div className="space-y-4">
            <BestPractice
              title="Name transitions descriptively"
              description="Use clear names that indicate what the transition does (e.g., 'submit_login', 'open_settings_dialog', 'close_error_popup')."
            />

            <BestPractice
              title="Use Incoming Transitions for verification"
              description="Add Incoming Transitions to verify that a state was reached successfully, especially after long-running operations or page loads."
            />

            <BestPractice
              title="Keep processes focused"
              description="Each transition's process should accomplish one logical task. Split complex workflows into multiple states and transitions."
            />

            <BestPractice
              title="Set appropriate timeouts"
              description="Use longer timeouts for transitions that involve slow operations (e.g., page loads, API calls). Use shorter timeouts for quick UI interactions."
            />

            <BestPractice
              title="Use stays_visible for overlays"
              description="When opening dialogs, modals, or tooltips over existing screens, set stays_visible=true to keep the background state active."
            />

            <BestPractice
              title="Manage parallel states explicitly"
              description="Use activate_states and deactivate_states to precisely control which states are active. This prevents unexpected behavior with parallel states."
            />
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-slate-200 pt-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Next Steps</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Action Types"
              description="Learn about all available actions for your processes"
              href="/docs/web/actions"
            />
            <NextStepCard
              title="Mock Testing"
              description="Test your state machine and transitions in the browser"
              href="/docs/web/testing"
            />
          </div>
        </section>
      </div>
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
      <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
        <p className="text-sm text-slate-700">{description}</p>
      </div>
    </div>
  );
}

interface TransitionTypeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  details: string[];
  example: {
    title: string;
    description: string;
    process: string;
  };
}

function TransitionTypeCard({
  icon,
  title,
  description,
  details,
  example,
}: TransitionTypeCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
          <p className="text-slate-600 mb-4">{description}</p>
          <ul className="space-y-2 mb-4">
            {details.map((detail, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-slate-700"
              >
                <span className="text-blue-600 font-bold">•</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-slate-600 mb-2">
          {example.title}
        </p>
        <p className="text-sm text-slate-800 font-mono mb-1">
          {example.description}
        </p>
        <p className="text-xs text-slate-600">{example.process}</p>
      </div>
    </div>
  );
}

interface PropertyCardProps {
  name: string;
  type: string;
  description: string;
  defaultValue?: string;
  isRequired?: boolean;
}

function PropertyCard({
  name,
  type,
  description,
  defaultValue,
  isRequired,
}: PropertyCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-mono font-semibold text-slate-900">{name}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-600">
            {type}
          </span>
          {isRequired && (
            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded">
              Required
            </span>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-700 mb-2">{description}</p>
      {defaultValue && (
        <p className="text-xs text-slate-500">
          Default:{" "}
          <span className="font-mono bg-slate-100 px-1 rounded">
            {defaultValue}
          </span>
        </p>
      )}
    </div>
  );
}

interface ParallelStateExampleProps {
  title: string;
  description: string;
  config: {
    from_state: string;
    to_state: string;
    stays_visible?: boolean;
    activate_states?: string[];
    deactivate_states?: string[];
    process: string;
  };
  result: string;
}

function ParallelStateExample({
  title,
  description,
  config,
  result,
}: ParallelStateExampleProps) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 mb-4">{description}</p>
      <div className="bg-white border border-slate-200 rounded p-3 font-mono text-xs mb-3">
        <div className="space-y-1">
          <div>
            <span className="text-blue-600">from_state:</span> "
            {config.from_state}"
          </div>
          <div>
            <span className="text-blue-600">to_state:</span> "{config.to_state}"
          </div>
          {config.stays_visible !== undefined && (
            <div>
              <span className="text-blue-600">stays_visible:</span>{" "}
              {config.stays_visible.toString()}
            </div>
          )}
          {config.activate_states && (
            <div>
              <span className="text-blue-600">activate_states:</span> [
              {config.activate_states.map((s) => `"${s}"`).join(", ")}]
            </div>
          )}
          {config.deactivate_states && (
            <div>
              <span className="text-blue-600">deactivate_states:</span> [
              {config.deactivate_states.map((s) => `"${s}"`).join(", ")}]
            </div>
          )}
          <div>
            <span className="text-blue-600">process:</span> "{config.process}"
          </div>
        </div>
      </div>
      <div className="bg-green-50 border border-green-200 rounded p-3">
        <p className="text-xs font-semibold text-green-900 mb-1">Result:</p>
        <p className="text-sm text-green-800">{result}</p>
      </div>
    </div>
  );
}

interface BestPracticeProps {
  title: string;
  description: string;
}

function BestPractice({ title, description }: BestPracticeProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <h4 className="font-semibold text-green-900 mb-2">{title}</h4>
      <p className="text-sm text-green-800">{description}</p>
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
      className="block bg-slate-50 border border-slate-200 rounded-lg p-6 hover:shadow-md hover:border-blue-300 transition-all"
    >
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600">{description}</p>
    </Link>
  );
}
