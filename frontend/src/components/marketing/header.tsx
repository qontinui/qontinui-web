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
  const [signupMode, setSignupMode] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  return (
    <>
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div
            className="flex items-center gap-1 cursor-pointer"
            onClick={() => router.push("/")}
          >
            <Image
              src="/q-logo.png"
              alt="Qontinui"
              width={32}
              height={32}
              className="h-8 w-auto"
            />
            <span className="text-2xl font-bold text-primary">ontinui</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/docs")}
              className="hover:bg-primary/10"
            >
              Docs
            </Button>
            <a
              href="https://github.com/qontinui"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" className="hover:bg-primary/10">
                <Github className="mr-2 h-4 w-4" />
                GitHub
              </Button>
            </a>
            <Button
              onClick={() => router.push("/runner/download")}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <Button
                  variant="outline"
                  onClick={() => router.push("/build/workflows")}
                  className="border-primary/50 hover:border-primary hover:bg-primary/10"
                >
                  Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                {user.is_superuser && (
                  <Button
                    variant="outline"
                    onClick={() => router.push("/admin")}
                    className="border-secondary/50 hover:border-secondary hover:bg-secondary/10"
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
                  setSignupMode(false);
                  setAuthDialogOpen(true);
                }}
                className="hover:bg-primary/10"
              >
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Auth Dialog */}
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={signupMode ? "signup" : "signin"}
      />
    </>
  );
}
