"use client";

import { Progress } from "@/components/ui/progress";
import { Check, AlertCircle } from "lucide-react";

interface UploadStatusMessagesProps {
  uploading: boolean;
  progress: number;
  error: string | null;
  success: boolean;
  validationErrors: string[];
  validationWarnings: string[];
}

export function UploadStatusMessages({
  uploading,
  progress,
  error,
  success,
  validationErrors,
  validationWarnings,
}: UploadStatusMessagesProps) {
  return (
    <>
      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Uploading...</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {validationWarnings.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-yellow-900 dark:text-yellow-100">
                Validation Warnings
              </h4>
              <ul className="mt-2 space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
                {validationWarnings.map((warning, idx) => (
                  <li key={idx}>&bull; {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-red-900 dark:text-red-100">
                Validation Errors
              </h4>
              <ul className="mt-2 space-y-1 text-sm text-red-800 dark:text-red-200">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>&bull; {err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {error && !validationErrors.length && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <Check className="h-5 w-5 text-green-600 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-green-900 dark:text-green-100">
                Upload Successful!
              </h4>
              <p className="text-sm text-green-800 dark:text-green-200 mt-1">
                Your recording has been uploaded and will be processed shortly.
                Redirecting to recording details...
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
