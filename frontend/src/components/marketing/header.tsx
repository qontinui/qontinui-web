"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { ArrowRight, LogIn, Github, Download } from "lucide-react";
import { AuthDialog } from "@/components/auth-dialog";
import { useAuth } from "@/contexts/auth-context";

export function Header() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  return (
    <>
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div
            className="flex items-center gap-1 cursor-pointer"
            role="link"
            tabIndex={0}
            onClick={() => router.push("/")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push("/");
              }
            }}
          >
            <Image
              src="/q-logo.png"
              alt="Qontinui"
              width={32}
              height={32}
              className="h-8 w-auto"
            />
            {/* Below `sm` the nav's own two buttons plus this wordmark ran
                the row to 564px at 390px viewport, pushing Download/Sign In
                off screen. Dropping the wordmark (the logo mark alone still
                identifies the brand) is cheaper than hiding a nav item. */}
            <span className="hidden sm:inline text-2xl font-bold text-primary">
              ontinui
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Docs hidden below `sm`: secondary nav, not the reason anyone
                opens this page on a phone. GitHub goes icon-only rather than
                hidden — `tests/e2e/pages/marketing.spec.ts` "has View on
                GitHub link" runs on the Mobile Chrome/Safari projects too and
                asserts the header's GitHub button stays visible there. */}
            <Button
              variant="ghost"
              onClick={() => router.push("/docs")}
              className="hidden sm:inline-flex hover:bg-primary/10"
            >
              Docs
            </Button>
            <a
              href="https://github.com/qontinui"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="ghost"
                className="hover:bg-primary/10"
                aria-label="GitHub"
              >
                <Github className="sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">GitHub</span>
              </Button>
            </a>
            <Button
              onClick={() => router.push("/runner/download")}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label="Download"
            >
              <Download className="sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Download</span>
            </Button>
            {user ? (
              <div className="flex items-center gap-2 sm:gap-4">
                <span className="hidden sm:inline text-sm text-muted-foreground">
                  {user.email}
                </span>
                <Button
                  variant="outline"
                  onClick={() => router.push("/build/workflows")}
                  className="border-primary/50 hover:border-primary hover:bg-primary/10"
                >
                  Dashboard
                  <ArrowRight className="ml-2 h-4 w-4 hidden sm:inline" />
                </Button>
                {user.is_superuser && (
                  // Hidden outright below `sm`, unlike Download/Sign In/GitHub:
                  // no distinctive icon to fall back to (a bare ArrowRight
                  // would be meaningless standing alone), and no e2e
                  // assertion needs it visible on the Mobile projects. It's
                  // one tap away via Dashboard for the superusers this gates.
                  <Button
                    variant="outline"
                    onClick={() => router.push("/admin")}
                    className="hidden sm:inline-flex border-secondary/50 hover:border-secondary hover:bg-secondary/10"
                  >
                    Admin
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setAuthDialogOpen(true);
                }}
                className="hover:bg-primary/10"
                aria-label="Sign In"
              >
                <LogIn className="sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Sign In</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Auth Dialog */}
      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </>
  );
}
