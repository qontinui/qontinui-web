import { useState } from "react";

export function useSecurityScan() {
  const [showSecurityScan, setShowSecurityScan] = useState(false);
  const [securityScanPassed, setSecurityScanPassed] = useState<boolean | null>(
    null
  );

  const handleSecurityScan = (code: string) => {
    setShowSecurityScan(true);
    setTimeout(() => {
      const hasDangerousPatterns =
        code.includes("eval(") || code.includes("exec(");
      setSecurityScanPassed(!hasDangerousPatterns);
    }, 1500);
  };

  return {
    showSecurityScan,
    securityScanPassed,
    handleSecurityScan,
  };
}
