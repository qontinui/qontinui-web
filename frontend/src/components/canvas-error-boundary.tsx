'use client';

import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, RefreshCw, Undo2 } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Canvas-specific error boundary for workflow canvas, state machine canvas,
 * and other interactive canvas components.
 *
 * Features:
 * - Specialized error handling for canvas operations
 * - Custom fallback UI optimized for canvas layout
 * - Canvas state recovery options
 * - Detailed error logging for canvas-specific issues
 */
export class CanvasErrorBoundary extends Component<Props, State> {
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

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log canvas-specific errors with additional context
    console.error('CanvasErrorBoundary caught an error:', {
      error,
      errorInfo,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'N/A',
    });

    // Check for common canvas errors
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('canvas')) {
      console.error('Canvas rendering error detected');
    } else if (errorMessage.includes('reactflow') || errorMessage.includes('xyflow')) {
      console.error('React Flow library error detected');
    } else if (errorMessage.includes('node') || errorMessage.includes('edge')) {
      console.error('Canvas node/edge manipulation error detected');
    }

    // Log to error reporting service (e.g., Sentry) in production
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
      // Example: window.Sentry?.captureException(error, {
      //   tags: { component: 'canvas' },
      //   extra: { errorInfo, canvasType: 'workflow' }
      // });
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    // Call parent reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }

    // Reset error boundary state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      const isDevelopment = process.env.NODE_ENV === 'development';

      return (
        <div className="flex items-center justify-center w-full h-full min-h-[400px] p-4">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <CardTitle>Canvas Error</CardTitle>
              </div>
              <CardDescription>
                The canvas encountered an error and could not render. Your data is safe.
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
                    <summary className="text-sm font-medium">Component Stack</summary>
                    <pre className="mt-2 text-xs overflow-auto rounded-lg bg-muted p-4 max-h-64">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Common causes:</p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>Invalid node or edge data structure</li>
                    <li>Missing required canvas dependencies</li>
                    <li>State synchronization issues</li>
                    <li>Browser canvas API limitations</li>
                  </ul>
                </div>
              </CardContent>
            )}

            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                onClick={this.handleReset}
                className="flex items-center gap-2"
              >
                <Undo2 className="h-4 w-4" />
                Reset Canvas
              </Button>
              <Button
                onClick={this.handleReload}
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Page
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
