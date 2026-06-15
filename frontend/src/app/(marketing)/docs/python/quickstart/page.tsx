import Link from "next/link";
import { Rocket, Code, CheckCircle2, AlertCircle } from "lucide-react";

export const metadata = {
  title: "Quick Start - Qontinui Python Documentation",
  description:
    "Get up and running with the Qontinui Python library: define a JSON automation config and execute it with JSONRunner.",
};

export default function PythonQuickStartPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Quick Start
          </h1>
          <p className="text-xl text-muted-foreground">
            Define an automation in JSON and run it with the Python API
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-3">
              <Rocket className="w-6 h-6 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">
                What You&apos;ll Build
              </h2>
            </div>
            <p className="text-sm text-foreground">
              Qontinui drives GUI automation from a declarative model: you
              describe <strong>states</strong> (screens, identified visually)
              and <strong>workflows</strong> (sequences of actions), then let
              the library execute them. The fastest way to start is a JSON
              configuration loaded and run through{" "}
              <code className="font-mono">JSONRunner</code>.
            </p>
          </div>
        </section>

        {/* Prerequisite */}
        <section className="mb-12">
          <div className="bg-muted border border-border rounded-lg p-4">
            <p className="text-sm text-foreground">
              <strong>Before you begin:</strong> make sure Qontinui is
              installed. See the{" "}
              <Link
                href="/docs/python/installation"
                className="text-primary hover:underline"
              >
                Installation guide
              </Link>{" "}
              if you haven&apos;t set it up yet.
            </p>
          </div>
        </section>

        {/* Step 1 */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-lg">
              1
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              Describe Your Automation in JSON
            </h2>
          </div>

          <p className="text-foreground mb-4">
            Create a file named{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              automation_config.json
            </code>
            . It declares the states Qontinui should recognize and the workflow
            of actions to perform:
          </p>

          <CodeBlock>
            {`{
  "version": "1.0",
  "states": [
    {
      "name": "LoginScreen",
      "stateImages": [
        { "imageId": "login_button", "threshold": 0.9 }
      ]
    }
  ],
  "processes": [
    {
      "name": "Login",
      "actions": [
        {
          "type": "CLICK",
          "target": { "type": "image", "imageId": "login_button" }
        },
        { "type": "TYPE", "text": "username@example.com" }
      ]
    }
  ]
}`}
          </CodeBlock>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mt-4">
            <p className="text-sm text-foreground">
              <strong>Visual identification:</strong> each{" "}
              <code className="font-mono">stateImage</code> references an image
              and a similarity <code className="font-mono">threshold</code>.
              Qontinui finds states by matching these images on screen rather
              than relying on hardcoded coordinates.
            </p>
          </div>
        </section>

        {/* Step 2 */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-accent text-accent-foreground rounded-full flex items-center justify-center font-bold text-lg">
              2
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              Load and Run It
            </h2>
          </div>

          <p className="text-foreground mb-4">
            Use <code className="font-mono">JSONRunner</code> to load the
            configuration and execute a named workflow. The{" "}
            <code className="font-mono">run()</code> method takes the workflow
            id (the workflow&apos;s <code className="font-mono">name</code>) and
            an optional monitor index:
          </p>

          <CodeBlock>
            {`from qontinui.json_executor import JSONRunner

# Create the runner
runner = JSONRunner()

# Load and validate the configuration
runner.load_configuration("automation_config.json")

# Execute the "Login" workflow on the primary monitor
success = runner.run("Login", monitor_index=0)

print("Automation succeeded" if success else "Automation failed")`}
          </CodeBlock>

          <div className="bg-muted border border-border rounded-lg p-4 mt-4">
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span>
                  <code className="font-mono">load_configuration()</code> parses
                  and validates the JSON, then initializes the executors and
                  hardware backends. It returns{" "}
                  <code className="font-mono">True</code> on success.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span>
                  <code className="font-mono">run()</code> executes the named
                  workflow and returns a boolean indicating overall success.
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Step 3: programmatic */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center font-bold text-lg">
              3
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              Or Build the Model in Code
            </h2>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <Code className="w-5 h-5 text-primary" />
            <p className="text-foreground">
              The same building blocks are exported directly from the{" "}
              <code className="font-mono">qontinui</code> package, so you can
              construct states and actions in Python instead of JSON:
            </p>
          </div>

          <CodeBlock>
            {`from qontinui import State, StateImage, Region, Location

# A state is identified by one or more images
login_screen = State(name="LoginScreen")

# A region describes a rectangular search area (x, y, width, height)
form_area = Region(x=100, y=200, width=400, height=300, name="login_form")

# A location is a point target for actions like click/hover
submit_point = Location(x=320, y=480)

print(login_screen.name, form_area.width, submit_point.x)`}
          </CodeBlock>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> Qontinui&apos;s action methods (find,
                click) are asynchronous — they are{" "}
                <code className="font-mono">async</code> coroutines that you{" "}
                <code className="font-mono">await</code> inside an async
                function. See the{" "}
                <Link
                  href="/docs/python/examples"
                  className="text-primary hover:underline"
                >
                  Examples
                </Link>{" "}
                page for full async patterns.
              </p>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Examples"
              description="Find, click, self-healing, and AWAS in real code"
              href="/docs/python/examples"
            />
            <NextStepCard
              title="Installation"
              description="Set up Qontinui and optional extras"
              href="/docs/python/installation"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-muted border border-border rounded-lg p-4 overflow-x-auto text-sm font-mono text-foreground">
      <code>{children}</code>
    </pre>
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
