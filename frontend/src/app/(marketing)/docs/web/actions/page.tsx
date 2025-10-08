import Link from "next/link";
import { Mouse, Keyboard, Eye, Navigation, Clock, Camera } from "lucide-react";

export const metadata = {
  title: "Action Types - Qontinui Web Documentation",
  description:
    "Complete reference for all action types in Qontinui: mouse, keyboard, vision, and navigation actions.",
};

export default function ActionsDocPage() {
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
            Action Types
          </h1>
          <p className="text-xl text-slate-600">
            Complete reference for all automation actions in Qontinui
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            What are Actions?
          </h2>
          <p className="text-slate-700 mb-4">
            Actions are the atomic operations performed during automation. They represent specific
            tasks like clicking a button, typing text, or finding an image on screen. Actions are
            organized into processes and executed during state transitions.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-blue-900 mb-3">
              Key Concepts
            </h3>
            <ul className="space-y-2 text-sm text-blue-900">
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Actions execute sequentially within a process</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Failed actions can be retried automatically</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Actions can target images, coordinates, or the last found image</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>Pauses can be added before and after each action</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Action Categories */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Action Categories
          </h2>

          <div className="space-y-8">
            {/* Mouse Actions */}
            <CategorySection
              icon={<Mouse className="w-6 h-6 text-blue-600" />}
              title="Mouse Actions"
              description="Control mouse movement and clicks"
            >
              <ActionCard
                name="CLICK"
                description="Left-click at the target location"
                params={[
                  { name: "target", desc: "Image, coordinates, or 'Last Find Result'" },
                  { name: "offset", desc: "Optional x/y offset from target" },
                ]}
                example="Click the login button found via image recognition"
              />
              <ActionCard
                name="DOUBLE_CLICK"
                description="Double-click at the target location"
                params={[
                  { name: "target", desc: "Image, coordinates, or 'Last Find Result'" },
                ]}
                example="Double-click to open a file"
              />
              <ActionCard
                name="RIGHT_CLICK"
                description="Right-click to open context menu"
                params={[
                  { name: "target", desc: "Image, coordinates, or 'Last Find Result'" },
                ]}
                example="Right-click to show context menu"
              />
              <ActionCard
                name="DRAG"
                description="Drag from source to destination"
                params={[
                  { name: "source", desc: "Starting location" },
                  { name: "destination", desc: "Ending location" },
                ]}
                example="Drag a file to trash"
              />
              <ActionCard
                name="MOUSE_MOVE / MOVE"
                description="Move mouse without clicking"
                params={[
                  { name: "target", desc: "Destination coordinates or image" },
                ]}
                example="Hover over an element to reveal tooltip"
              />
              <ActionCard
                name="MOUSE_DOWN / MOUSE_UP"
                description="Press or release mouse button"
                params={[
                  { name: "button", desc: "Mouse button: left, right, middle" },
                ]}
                example="Hold mouse button for custom drag operations"
              />
              <ActionCard
                name="SCROLL / MOUSE_SCROLL"
                description="Scroll mouse wheel"
                params={[
                  { name: "amount", desc: "Scroll amount (positive = down, negative = up)" },
                  { name: "direction", desc: "Optional: vertical or horizontal" },
                ]}
                example="Scroll down to load more content"
              />
            </CategorySection>

            {/* Keyboard Actions */}
            <CategorySection
              icon={<Keyboard className="w-6 h-6 text-green-600" />}
              title="Keyboard Actions"
              description="Type text and press keys"
            >
              <ActionCard
                name="TYPE"
                description="Type a text string"
                params={[
                  { name: "text", desc: "Text to type" },
                  { name: "interval", desc: "Optional delay between keystrokes (ms)" },
                ]}
                example="Type username into login field"
              />
              <ActionCard
                name="KEY_PRESS"
                description="Press and release a key"
                params={[
                  { name: "key", desc: "Key name (e.g., 'enter', 'tab', 'ctrl+c')" },
                ]}
                example="Press Enter to submit form"
              />
              <ActionCard
                name="KEY_DOWN / KEY_UP"
                description="Press or release a specific key"
                params={[
                  { name: "key", desc: "Key name to press or release" },
                ]}
                example="Hold Shift while clicking for multi-select"
              />
            </CategorySection>

            {/* Vision Actions */}
            <CategorySection
              icon={<Eye className="w-6 h-6 text-purple-600" />}
              title="Vision Actions"
              description="Find and verify visual elements"
            >
              <ActionCard
                name="FIND"
                description="Locate an image on screen and store its location"
                params={[
                  { name: "target", desc: "Image to find" },
                  { name: "similarity", desc: "Match threshold (0.7-0.95)" },
                ]}
                example="Find the submit button before clicking it"
                important="The found location is stored and can be used by subsequent actions with target: 'Last Find Result'"
              />
              <ActionCard
                name="EXISTS"
                description="Check if an image exists (returns true/false)"
                params={[
                  { name: "target", desc: "Image to check for" },
                  { name: "similarity", desc: "Match threshold" },
                ]}
                example="Verify a confirmation dialog appeared"
              />
              <ActionCard
                name="VANISH"
                description="Wait for an image to disappear from screen"
                params={[
                  { name: "target", desc: "Image to wait for disappearance" },
                  { name: "timeout", desc: "Maximum wait time (ms)" },
                ]}
                example="Wait for loading spinner to disappear"
              />
            </CategorySection>

            {/* Navigation Actions */}
            <CategorySection
              icon={<Navigation className="w-6 h-6 text-orange-600" />}
              title="Navigation Actions"
              description="Navigate states and execute processes"
            >
              <ActionCard
                name="GO_TO_STATE"
                description="Navigate to a target state using pathfinding"
                params={[
                  { name: "stateId", desc: "ID of target state" },
                ]}
                example="Navigate to the settings page from anywhere"
                important="Uses automatic pathfinding through the state graph"
              />
              <ActionCard
                name="RUN_PROCESS"
                description="Execute another process by ID"
                params={[
                  { name: "processId", desc: "ID of process to execute" },
                ]}
                example="Run a reusable login process"
              />
            </CategorySection>

            {/* Utility Actions */}
            <CategorySection
              icon={<Clock className="w-6 h-6 text-slate-600" />}
              title="Utility Actions"
              description="Timing and debugging utilities"
            >
              <ActionCard
                name="WAIT"
                description="Pause execution for a specified duration"
                params={[
                  { name: "duration", desc: "Wait time in milliseconds" },
                ]}
                example="Wait 2 seconds for page to load"
              />
              <ActionCard
                name="SCREENSHOT"
                description="Capture the current screen"
                params={[
                  { name: "filename", desc: "Optional filename for screenshot" },
                ]}
                example="Take screenshot for debugging or verification"
              />
            </CategorySection>
          </div>
        </section>

        {/* Common Parameters */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Common Action Parameters
          </h2>

          <div className="space-y-4">
            <ParamCard
              name="target"
              type="Object or String"
              description="Specifies where the action should be performed"
              options={[
                { value: '{"type": "image", "imageId": "..."}', desc: "Find and target an image" },
                { value: '{"type": "coordinates", "x": 100, "y": 200}', desc: "Use fixed coordinates" },
                { value: '"Last Find Result"', desc: "Use location from last FIND action" },
              ]}
            />

            <ParamCard
              name="similarity"
              type="Number (0.0 - 1.0)"
              description="Image matching threshold for visual actions"
              options={[
                { value: "0.7 - 0.8", desc: "Fuzzy matching (more tolerant)" },
                { value: "0.85 - 0.9", desc: "Standard matching (recommended)" },
                { value: "0.95+", desc: "Exact matching (strict)" },
              ]}
            />

            <ParamCard
              name="retry_count"
              type="Integer"
              description="Number of retry attempts if action fails (default: 3)"
            />

            <ParamCard
              name="timeout"
              type="Integer (milliseconds)"
              description="Maximum time to wait for action completion (default: 5000)"
            />

            <ParamCard
              name="continue_on_error"
              type="Boolean"
              description="If true, process continues even if this action fails (default: false)"
            />

            <ParamCard
              name="pause_before_begin"
              type="Integer (milliseconds)"
              description="Wait time before executing action"
            />

            <ParamCard
              name="pause_after_end"
              type="Integer (milliseconds)"
              description="Wait time after action completes"
            />

            <ParamCard
              name="offset"
              type="Object {x, y}"
              description="Offset from target location in pixels"
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
              title="Use FIND before CLICK for reliability"
              description="Always use a FIND action before clicking an image target. This ensures the element exists and updates the 'Last Find Result' location."
              example='1. FIND (target: login_button) → 2. CLICK (target: "Last Find Result")'
            />

            <BestPractice
              title="Set appropriate similarity thresholds"
              description="Start with 0.85 and adjust based on results. Lower for elements that change slightly, higher for exact matches."
            />

            <BestPractice
              title="Add pauses for slow applications"
              description="Use pause_after_end for actions that trigger slow operations (e.g., page loads, animations)."
            />

            <BestPractice
              title="Use continue_on_error sparingly"
              description="Only use for truly optional actions. Most actions should fail the process if they fail."
            />

            <BestPractice
              title="Combine actions into logical processes"
              description="Group related actions into named processes for reusability and clarity (e.g., 'login_sequence', 'submit_form')."
            />
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-slate-200 pt-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="State Transitions"
              description="Learn how to connect states using processes"
              href="/docs/web/transitions"
            />
            <NextStepCard
              title="Working with States"
              description="Understand state identification and structure"
              href="/docs/web/states"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface CategorySectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function CategorySection({ icon, title, description, children }: CategorySectionProps) {
  return (
    <div className="border border-slate-200 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <div>
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-600">{description}</p>
        </div>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

interface ActionCardProps {
  name: string;
  description: string;
  params: Array<{ name: string; desc: string }>;
  example?: string;
  important?: string;
}

function ActionCard({ name, description, params, example, important }: ActionCardProps) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
      <h4 className="font-mono font-bold text-slate-900 mb-2">{name}</h4>
      <p className="text-sm text-slate-700 mb-3">{description}</p>

      <div className="mb-3">
        <p className="text-xs font-semibold text-slate-600 mb-1">Parameters:</p>
        <ul className="text-xs text-slate-600 space-y-1">
          {params.map((param, idx) => (
            <li key={idx} className="font-mono">
              <span className="text-blue-600">{param.name}</span>: {param.desc}
            </li>
          ))}
        </ul>
      </div>

      {example && (
        <div className="text-xs text-slate-600 italic">
          Example: {example}
        </div>
      )}

      {important && (
        <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-900">
          <strong>Important:</strong> {important}
        </div>
      )}
    </div>
  );
}

interface ParamCardProps {
  name: string;
  type: string;
  description: string;
  options?: Array<{ value: string; desc: string }>;
}

function ParamCard({ name, type, description, options }: ParamCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-mono font-semibold text-slate-900">{name}</h4>
        <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-600">
          {type}
        </span>
      </div>
      <p className="text-sm text-slate-700 mb-3">{description}</p>

      {options && (
        <div className="space-y-1">
          {options.map((opt, idx) => (
            <div key={idx} className="text-xs">
              <span className="font-mono text-blue-600">{opt.value}</span>
              <span className="text-slate-600"> - {opt.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BestPracticeProps {
  title: string;
  description: string;
  example?: string;
}

function BestPractice({ title, description, example }: BestPracticeProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <h4 className="font-semibold text-green-900 mb-2">{title}</h4>
      <p className="text-sm text-green-800 mb-2">{description}</p>
      {example && (
        <p className="text-xs font-mono bg-white border border-green-200 rounded p-2 text-slate-700">
          {example}
        </p>
      )}
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
