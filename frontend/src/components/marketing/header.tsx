"use client"

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowRight, LogIn } from 'lucide-react';
import { AuthDialog } from '@/components/auth-dialog';
import { useAuth } from '@/contexts/auth-context';

export function Header() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [signupMode, setSignupMode] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  return (
    <>
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h2
            className="text-2xl font-bold text-primary cursor-pointer"
            onClick={() => router.push('/')}
          >
            Qontinui
          </h2>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push('/runner/download')}
              className="hover:bg-primary/10"
            >
              Download
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push('/docs')}
              className="hover:bg-primary/10"
            >
              Docs
            </Button>
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-muted-foreground">{user.email}</span>
                <Button
                  variant="outline"
                  onClick={() => router.push('/dashboard')}
                  className="border-primary/50 hover:border-primary hover:bg-primary/10"
                >
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                {user.is_superuser && (
                  <Button
                    variant="outline"
                    onClick={() => router.push('/admin')}
                    className="border-secondary/50 hover:border-secondary hover:bg-secondary/10"
                  >
                    Go to Admin
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setSignupMode(false);
                  setAuthDialogOpen(true);
                }}
                className="border-primary/50 hover:border-primary hover:bg-primary/10"
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
