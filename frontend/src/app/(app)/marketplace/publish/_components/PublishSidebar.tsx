"use client";

import { Upload, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PublishSidebarProps {
  code: string;
  showSecurityScan: boolean;
  securityScanPassed: boolean | null;
  isFormValid: boolean;
  isPublishing: boolean;
  onSecurityScan: () => void;
  onPublish: () => void;
}

export function PublishSidebar({
  code,
  showSecurityScan,
  securityScanPassed,
  isFormValid,
  isPublishing,
  onSecurityScan,
  onPublish,
}: PublishSidebarProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle className="text-base">Security Scan</CardTitle>
          <CardDescription>
            Scan your code for security issues before publishing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={onSecurityScan}
            disabled={!code || showSecurityScan}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {showSecurityScan ? "Scanning..." : "Run Security Scan"}
          </Button>

          {showSecurityScan && securityScanPassed !== null && (
            <Alert
              variant={securityScanPassed ? "default" : "destructive"}
              className={
                securityScanPassed ? "border-green-500/50 bg-green-500/10" : ""
              }
            >
              <AlertDescription className="flex items-start gap-2">
                {securityScanPassed ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-500" />
                    <div>
                      <div className="font-medium text-green-500">
                        Scan passed
                      </div>
                      <div className="text-xs text-muted-foreground">
                        No security issues detected
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Security issues found</div>
                      <div className="text-xs">
                        Potentially dangerous patterns detected (eval, exec)
                      </div>
                    </div>
                  </>
                )}
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
        disabled={
          !isFormValid ||
          isPublishing ||
          (showSecurityScan && !securityScanPassed)
        }
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
