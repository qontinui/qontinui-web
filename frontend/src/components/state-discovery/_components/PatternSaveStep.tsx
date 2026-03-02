import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Loader2, Save, AlertCircle } from "lucide-react";

interface PatternSaveStepProps {
  patternCount: number;
  saving: boolean;
  saveProgress: number;
  onSave: () => void;
}

export default function PatternSaveStep({
  patternCount,
  saving,
  saveProgress,
  onSave,
}: PatternSaveStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
            3
          </div>
          Save Patterns
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-text-muted">
            {patternCount} pattern
            {patternCount !== 1 ? "s" : ""} ready to save to image library
          </p>
          <Button onClick={onSave} disabled={saving} size="lg">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save to Image Library
              </>
            )}
          </Button>
        </div>

        {saving && (
          <div className="space-y-2">
            <Progress value={saveProgress} className="h-2" />
            <p className="text-xs text-text-muted text-center">
              Saving patterns... {saveProgress}%
            </p>
          </div>
        )}

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Patterns will be saved to your image library and can be used in
            state definitions. You can assign them to states after saving.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
