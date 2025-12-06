/**
 * Delete Confirmation Dialog Component
 * Shows impact analysis and confirmation for StateImage deletion
 */

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { StateImage, DeletionImpact } from "@/types/stateDiscovery";
import { useStateDiscovery } from "@/hooks/useStateDiscovery";

interface DeleteConfirmationDialogProps {
  stateImage: StateImage;
  onConfirm: (options: any) => void;
  onCancel: () => void;
}

const DeleteConfirmationDialog: React.FC<DeleteConfirmationDialogProps> = ({
  stateImage,
  onConfirm,
  onCancel,
}) => {
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cascade, setCascade] = useState(true);
  const [force, setForce] = useState(false);
  const [orphanStrategy, setOrphanStrategy] = useState<
    "keep" | "delete" | "merge"
  >("keep");

  const { getDeleteImpact } = useStateDiscovery();

  // Load deletion impact
  useEffect(() => {
    const loadImpact = async () => {
      setIsLoading(true);
      try {
        const impactData = await getDeleteImpact(stateImage.id);
        setImpact(impactData);
      } catch (error) {
        console.error("Failed to load deletion impact:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadImpact();
  }, [stateImage.id, getDeleteImpact]);

  const handleConfirm = () => {
    onConfirm({
      cascade,
      force,
      handleOrphans: orphanStrategy,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Delete StateImage?
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{stateImage.name}"?
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : impact ? (
          <div className="space-y-4">
            {/* Impact Summary */}
            <Alert variant={impact.isCritical ? "destructive" : "default"}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="font-semibold">Impact Analysis:</div>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>
                      Affects {impact.statesAffected} state
                      {impact.statesAffected !== 1 ? "s" : ""}
                    </li>
                    <li>
                      Present in {stateImage.screenshots?.length || 0} screenshot(s)
                    </li>
                    {impact.willCreateOrphans && (
                      <li className="text-red-600">
                        Will create orphaned states
                      </li>
                    )}
                    {impact.isCritical && (
                      <li className="text-red-600 font-semibold">
                        This is a critical StateImage
                      </li>
                    )}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>

            {/* Recommendations */}
            {impact.recommendations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Info className="h-4 w-4 text-blue-500" />
                  Recommendations
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  {impact.recommendations.map((rec, index) => (
                    <li key={index}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Deletion Options */}
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="cascade"
                  checked={cascade}
                  onCheckedChange={(checked) => setCascade(checked as boolean)}
                />
                <Label htmlFor="cascade" className="text-sm">
                  Remove from all states (cascade)
                </Label>
              </div>

              {impact.isCritical && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="force"
                    checked={force}
                    onCheckedChange={(checked) => setForce(checked as boolean)}
                  />
                  <Label htmlFor="force" className="text-sm text-red-600">
                    Force delete critical StateImage
                  </Label>
                </div>
              )}

              {impact.willCreateOrphans && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">
                    Handle orphaned states:
                  </Label>
                  <RadioGroup
                    value={orphanStrategy}
                    onValueChange={(value: any) => setOrphanStrategy(value)}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="keep" id="keep" />
                      <Label htmlFor="keep" className="text-sm">
                        Keep for review
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="delete" id="delete" />
                      <Label htmlFor="delete" className="text-sm">
                        Delete orphaned states
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="merge" id="merge" />
                      <Label htmlFor="merge" className="text-sm">
                        Auto-merge with similar states
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              )}
            </div>
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load deletion impact analysis.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isLoading || (impact?.isCritical && !force)}
          >
            Delete StateImage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteConfirmationDialog;
