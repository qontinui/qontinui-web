import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-bold text-primary mb-4">Qontinui</h3>
            <p className="text-sm text-muted-foreground">
              Open-source AI development platform with orchestrated workflows,
              verification loops, and visual feedback.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/runner/download"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Download Runner
                </Link>
              </li>
              <li>
                <Link
                  href="/docs"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/qontinui/qontinui-runner"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>

          {/* Research & Open Source */}
          <div>
            <h4 className="font-semibold mb-4">Research & Open Source</h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://link.springer.com/article/10.1007/s10270-025-01319-9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Springer Paper (2025)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/qontinui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  GitHub Organization
                </a>
              </li>
              <li>
                <a
                  href="https://qontinui.github.io/multistate/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  multistate Docs
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/privacy"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/acceptable-use"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Acceptable Use Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/responsible-use"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Responsible Use FAQ
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-8 pt-8 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Qontinui. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
