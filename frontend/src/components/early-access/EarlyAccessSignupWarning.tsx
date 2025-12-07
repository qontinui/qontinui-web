"use client";

import React, { useState } from "react";
import { AlertCircle, Download, RefreshCw, Check } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Early Access Signup Warning
 *
 * Prominent warning shown BEFORE account creation in the signup form.
 * Informs users about early access status and the importance of exporting.
 *
 * Based on: EARLY-ACCESS-WARNING-IMPLEMENTATION.md lines 40-57
 */
export function EarlyAccessSignupWarning() {
  const [showLearnMore, setShowLearnMore] = useState(false);

  return (
    <>
      <Alert
        className={cn(
          "mb-6 border-blue-500/50 bg-blue-500/10",
          "shadow-[0_0_15px_rgba(59,130,246,0.1)]"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <img
                src="/early-access.svg"
                alt="Early Access"
                className="h-5 w-5"
              />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <AlertTitle className="text-lg font-bold mb-3 text-blue-300">
              EARLY ACCESS - Launching February 2026
            </AlertTitle>
            <AlertDescription className="space-y-2 text-sm text-gray-300">
              <p>You're trying Qontinui before the official launch!</p>

              <div className="space-y-1.5 my-3">
                <div className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Fully functional - create automations now</span>
                </div>
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <span>Breaking changes possible before Feb 2026</span>
                </div>
                <div className="flex items-start gap-2">
                  <Download className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <span>Export your projects as JSON regularly</span>
                </div>
                <div className="flex items-start gap-2">
                  <RefreshCw className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                  <span>JSON import always backward compatible</span>
                </div>
              </div>

              <p className="text-gray-400 italic mt-3">
                By signing up, you're joining as an early tester. Your feedback
                helps shape the product!
              </p>
            </AlertDescription>

            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowLearnMore(true)}
                className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 p-0 h-auto"
              >
                Learn More About Early Access →
              </Button>
            </div>
          </div>
        </div>
      </Alert>

      {/* Learn More Modal */}
      <Dialog open={showLearnMore} onOpenChange={setShowLearnMore}>
        <DialogContent className="max-w-2xl border-gray-800/50 bg-[#0A0A0B] text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-blue-400">
              Early Access FAQ
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Everything you need to know about using Qontinui in early access
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4 max-h-[60vh] overflow-y-auto pr-2">
            {/* FAQ Items */}
            <div>
              <h3 className="font-semibold text-white mb-2">
                Q: What does "early access" mean?
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                You can use qontinui-web now, before the official February 2026
                launch. All features work, but the interface and functionality
                may change based on user feedback.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">
                Q: Will I lose my work?
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                Not if you export! Use File → Export to save your automation as
                a JSON file. This JSON will always be compatible with future
                versions.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">
                Q: What are "breaking changes"?
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                We might reorganize the interface, change workflows, or update
                features before launch. Your saved JSON files will always
                import, but the web interface might look different between
                visits.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">
                Q: Should I use this for production?
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                If you export your work regularly, yes! Many users run
                automations from exported JSON files using qontinui-runner
                (desktop app).
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">
                Q: How often should I export?
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                After each significant change. Think of it like "Save" in a
                document.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">
                Q: What happens after February 2026 launch?
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">
                Early access ends, official version launches. All your exported
                JSON files will import seamlessly. Accounts created during early
                access remain active.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              onClick={() => setShowLearnMore(false)}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              Got it!
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
