export function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  );
}

export function getSourceLabel(source: string) {
  switch (source) {
    case "uploaded":
      return "Uploaded";
    case "pattern_optimization":
      return "Pattern Opt";
    case "image_extraction":
      return "Extraction";
    case "state_discovery":
      return "Discovery";
    default:
      return "Unknown";
  }
}

export function getSourceColor(source: string) {
  switch (source) {
    case "uploaded":
      return "hsl(var(--brand-success))";
    case "pattern_optimization":
      return "hsl(var(--brand-primary))";
    case "image_extraction":
      return "hsl(var(--brand-secondary))";
    case "state_discovery":
      return "hsl(var(--brand-warning))";
    default:
      return "hsl(var(--text-muted))";
  }
}
