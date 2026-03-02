interface OutputTabProps {
  outputSummary: string;
}

export function OutputTab({ outputSummary }: OutputTabProps) {
  return (
    <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-[600px] overflow-y-auto bg-muted/50 p-4 rounded-lg">
      {outputSummary}
    </pre>
  );
}
