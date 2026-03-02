import React from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type {
  ApplicationProfile,
  TuningResult,
} from "@/services/template-capture-service";

interface TuningDialogProps {
  profile: ApplicationProfile | null;
  result: TuningResult | null;
  onClose: () => void;
  onTune: () => void;
  submitting: boolean;
}

export function TuningDialog({
  profile,
  result,
  onClose,
  onTune,
  submitting,
}: TuningDialogProps) {
  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auto-Tune: {profile?.name}</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <Badge className="bg-green-500">Success</Badge>
                ) : (
                  <Badge className="bg-red-500">Failed</Badge>
                )}
                {result.message && (
                  <span className="text-sm">{result.message}</span>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>Samples analyzed:</strong>{" "}
                  {result.metrics.samples_analyzed}
                </p>
                <p className="text-sm">
                  <strong>Boundary accuracy:</strong>{" "}
                  {Math.round(result.metrics.avg_boundary_accuracy * 100)}%
                </p>
                <p className="text-sm">
                  <strong>Recommended strategies:</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.recommended_strategies.map((s) => (
                    <Badge key={s} variant="outline">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">
                Auto-tuning will analyze approved templates to optimize
                detection parameters for this application.
              </p>
              <Button onClick={onTune} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Tuning...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Start Tuning
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
