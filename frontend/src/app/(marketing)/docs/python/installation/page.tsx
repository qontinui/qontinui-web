import Link from "next/link";
import { Package, Terminal, CheckCircle2, AlertCircle } from "lucide-react";

export const metadata = {
  title: "Installation - Qontinui Python Documentation",
  description:
    "Install the Qontinui Python library for model-based GUI automation with PyTorch, OpenCV, and Transformers on Python 3.12+.",
};

export default function PythonInstallationPage() {
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
            Installation
          </h1>
          <p className="text-xl text-muted-foreground">
            Install the Qontinui Python library for model-based GUI automation
          </p>
        </div>

        {/* Requirements */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Requirements
          </h2>
          <p className="text-foreground mb-6">
            Qontinui is a Python library for model-based GUI automation with
            intelligent state management and visual recognition. Before
            installing, make sure your environment meets these requirements:
          </p>

          <div className="bg-muted border border-border rounded-lg p-6">
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Python 3.12+</strong>
                  <p className="text-sm text-muted-foreground">
                    Qontinui targets Python 3.12 and newer. Earlier versions are
                    not supported.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">
                    Native dependencies
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    Installation pulls in PyTorch, OpenCV (headless), and
                    Hugging Face Transformers, plus input-control libraries
                    (PyAutoGUI, pynput). These are installed automatically.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Cross-platform</strong>
                  <p className="text-sm text-muted-foreground">
                    Works on Windows, macOS, and Linux.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        {/* Install from PyPI */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Package className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">
              Install from PyPI
            </h2>
          </div>
          <p className="text-foreground mb-4">
            The recommended way to install Qontinui is from PyPI using{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              pip
            </code>
            . This installs the <code className="font-mono">qontinui</code>{" "}
            package along with all of its runtime dependencies.
          </p>

          <CodeBlock>{"pip install qontinui"}</CodeBlock>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mt-4">
            <p className="text-sm text-foreground">
              <strong>Tip:</strong> Because Qontinui depends on PyTorch and
              other large native packages, installing inside a dedicated virtual
              environment is strongly recommended:
            </p>
          </div>

          <div className="mt-4">
            <CodeBlock>
              {[
                "python -m venv .venv",
                "# macOS / Linux",
                "source .venv/bin/activate",
                "# Windows (PowerShell)",
                ".venv\\Scripts\\Activate.ps1",
                "",
                "pip install qontinui",
              ].join("\n")}
            </CodeBlock>
          </div>
        </section>

        {/* Install from source */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Terminal className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">
              Install from Source
            </h2>
          </div>
          <p className="text-foreground mb-4">
            For development, or to track the latest changes, install from the
            GitHub repository. Qontinui uses{" "}
            <Link
              href="https://python-poetry.org/"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Poetry
            </Link>{" "}
            to manage dependencies.
          </p>

          <CodeBlock>
            {[
              "git clone https://github.com/qontinui/qontinui.git",
              "cd qontinui",
              "",
              "# Install with Poetry (recommended for development)",
              "poetry install",
              "",
              "# Or with pip in editable mode",
              "pip install -e .",
            ].join("\n")}
          </CodeBlock>

          <div className="bg-muted border border-border rounded-lg p-4 mt-4">
            <p className="text-sm text-foreground">
              The Poetry install also wires up two sibling path dependencies
              that ship with the project:{" "}
              <code className="font-mono">qontinui-schemas</code> (shared type
              definitions) and <code className="font-mono">multistate</code>{" "}
              (the multi-state state-management library).
            </p>
          </div>
        </section>

        {/* Optional extras */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Optional Extras
          </h2>
          <p className="text-foreground mb-4">
            Qontinui defines a few optional dependency groups (extras) for
            advanced features. Enable them with Poetry when you need them:
          </p>

          <CodeBlock>
            {[
              "# UI-TARS quantization support (local inference on consumer GPUs)",
              "poetry install -E uitars",
              "",
              "# Local embeddings via sentence-transformers",
              "poetry install -E embeddings",
              "",
              "# PaddleOCR as an alternative OCR engine for OmniParser",
              "poetry install -E omniparser",
            ].join("\n")}
          </CodeBlock>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> SAM3 segmentation support must be
                installed manually and is not available as a Poetry extra:{" "}
                <code className="font-mono">
                  pip install git+https://github.com/facebookresearch/sam3.git
                </code>
              </p>
            </div>
          </div>
        </section>

        {/* Verify */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Verify the Installation
          </h2>
          <p className="text-foreground mb-4">
            Confirm Qontinui imports correctly and check the installed version:
          </p>

          <CodeBlock>
            {['python -c "import qontinui; print(qontinui.__version__)"'].join(
              "\n"
            )}
          </CodeBlock>

          <p className="text-foreground mt-4 mb-2">
            A successful install also exposes the{" "}
            <code className="font-mono">qontinui</code> command-line entry
            point:
          </p>
          <CodeBlock>{"qontinui --help"}</CodeBlock>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Quick Start"
              description="Run your first automation with the Python API"
              href="/docs/python/quickstart"
            />
            <NextStepCard
              title="Examples"
              description="Real-world code samples using the public API"
              href="/docs/python/examples"
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
