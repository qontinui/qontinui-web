"use client";

import { Upload, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PreCheckResult } from "../_hooks/usePublishPreCheck";

interface PublishSidebarProps {
  code: string;
  preCheckResult: PreCheckResult;
  isFormValid: boolean;
  isPublishing: boolean;
  onPreCheck: () => void;
  onPublish: () => void;
}

export function PublishSidebar({
  code,
  preCheckResult,
  isFormValid,
  isPublishing,
  onPreCheck,
  onPublish,
}: PublishSidebarProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle className="text-base">Pre-check</CardTitle>
          <CardDescription>
            A quick local check for <code>eval(</code> and <code>exec(</code>.
            The security scan runs on the server when a version is published.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={onPreCheck}
            disabled={!code}
          >
            <Search className="w-4 h-4 mr-2" />
            Run pre-check
          </Button>

          {preCheckResult === "clean" && (
            <Alert
              variant="default"
              data-ui-bridge-id="marketplace.publish-pre-check"
              data-pre-check={preCheckResult}
            >
              <AlertDescription className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                <div className="text-sm">
                  Pre-check: no <code>eval(</code>/<code>exec(</code> found —
                  the security scan runs when a version is published
                </div>
              </AlertDescription>
            </Alert>
          )}
          {preCheckResult === "flagged" && (
            <Alert
              variant="destructive"
              data-ui-bridge-id="marketplace.publish-pre-check"
              data-pre-check={preCheckResult}
            >
              <AlertDescription className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">
                    Pre-check: <code>eval(</code> or <code>exec(</code> found
                  </div>
                  <div className="text-xs">
                    Remove it before publishing — the security scan flags
                    dynamic code execution
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle className="text-base">Publishing Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="space-y-2 list-disc list-inside">
            <li>Provide clear, descriptive names</li>
            <li>Write comprehensive documentation</li>
            <li>Include usage examples</li>
            <li>Test your code thoroughly</li>
            <li>Follow security best practices</li>
            <li>Respect intellectual property</li>
          </ul>
        </CardContent>
      </Card>

      <Button
        size="lg"
        className="w-full bg-primary"
        onClick={onPublish}
        disabled={!isFormValid || isPublishing || preCheckResult === "flagged"}
      >
        {isPublishing ? (
          <>
            <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Publishing...
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Publish Package
          </>
        )}
      </Button>

      {!isFormValid && (
        <p className="text-xs text-muted-foreground text-center">
          Please fill in all required fields (*)
        </p>
      )}
    </div>
  );
}
