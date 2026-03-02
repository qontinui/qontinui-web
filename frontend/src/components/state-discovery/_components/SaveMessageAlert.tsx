import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { SaveMessage } from "../_hooks/useScreenshotUploader";

interface SaveMessageAlertProps {
  message: SaveMessage;
}

const SaveMessageAlert: React.FC<SaveMessageAlertProps> = ({ message }) => {
  return (
    <Alert
      className={`py-2 ${
        message.type === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : message.type === "info"
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-green-200 bg-green-50 text-green-700"
      }`}
    >
      <AlertDescription className="text-xs">{message.text}</AlertDescription>
    </Alert>
  );
};

export default SaveMessageAlert;
