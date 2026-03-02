import React from "react";
import { Info } from "lucide-react";

interface ShellHelpTextProps {
  title: string;
  description: string;
}

export function ShellHelpText({ title, description }: ShellHelpTextProps) {
  return (
    <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
      <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-blue-900 dark:text-blue-100">
        <p className="font-medium mb-1">{title}</p>
        <p>{description}</p>
      </div>
    </div>
  );
}
