"use client";

import React, { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Log to dev-debug-logger in development
    if (
      typeof window !== "undefined" &&
      process.env.NODE_ENV === "development"
    ) {
      import("@/lib/dev-debug-logger")
        .then(({ devDebugLogger }) => {
          devDebugLogger.logReactError(error, {
            componentStack: errorInfo.componentStack || undefined,
          });
        })
        .catch(() => {
          // Ignore import errors
        });

      // Report to UI Bridge browser event capture
      const bridge = (window as unknown as Record<string, unknown>)
        .__UI_BRIDGE__ as
        | {
            browserCapture?: {
              reportReactError?: (
                error: Error,
                info: { componentStack?: string }
              ) => void;
            };
          }
        | undefined;
      bridge?.browserCapture?.reportReactError?.(error, {
        componentStack: errorInfo.componentStack || undefined,
      });
    }

    // Report to the client-telemetry beacon.
    //
    // This branch used to be an empty block holding a commented-out `// Example:
    // window.Sentry?.captureException(...)`, so EVERY production error caught
    // here was silently swallowed — the boundary rendered its card and nothing
    // was ever reported. On 2026-08-26 a throw in a cloud-control slot
    // white-screened every authenticated page on qontinui.io and produced no
    // telemetry at all; the cause had to be read out of a user's console.
    //
    // Routed through the beacon rather than a direct Sentry call so React
    // errors inherit the same scrubbing, sampling, rate limit and circuit
    // breaker as every other incident. `captureReactError` is a no-op when the
    // beacon is not installed, so this is safe to call unconditionally — no
    // NODE_ENV check, which also means the path is exercised in tests and dev
    // instead of only ever running in production.
    if (typeof window !== "undefined") {
      import("@/lib/telemetry/beacon")
        .then(({ captureReactError }) => {
          captureReactError(error, errorInfo.componentStack ?? undefined);
        })
        .catch(() => {
          // Never let the reporter break the boundary that is already handling
          // an error.
        });
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      const isDevelopment = process.env.NODE_ENV === "development";

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <CardTitle>Something went wrong</CardTitle>
              </div>
              <CardDescription>
                An unexpected error occurred. We apologize for the
                inconvenience.
              </CardDescription>
            </CardHeader>

            {isDevelopment && this.state.error && (
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm font-mono text-muted-foreground">
                    {this.state.error.toString()}
                  </p>
                </div>

                {this.state.errorInfo && (
                  <details className="cursor-pointer">
                    <summary className="text-sm font-medium">
                      Stack Trace
                    </summary>
                    <pre className="mt-2 text-xs overflow-auto rounded-lg bg-muted p-4">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </CardContent>
            )}

            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                onClick={this.handleReset}
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={this.handleReload}
                className="flex items-center gap-2"
              >
                Reload Page
              </Button>
              <Button
                onClick={this.handleGoHome}
                className="flex items-center gap-2"
              >
                <Home className="h-4 w-4" />
                Go Home
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
