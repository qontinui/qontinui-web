import { formatMoney } from "@/app/(app)/overview/types";

interface MoneyProps {
  micros?: number;
  currency: string;
  original?: { micros: number; currency: string };
}

export function Money({ micros, currency, original }: MoneyProps) {
  const formatted = formatMoney(micros, currency);

  if (!original || original.currency === currency) {
    return <span>{formatted}</span>;
  }

  const originalFormatted = formatMoney(original.micros, original.currency);
  const rate = micros && original.micros ? (micros / original.micros).toFixed(2) : "?";

  return (
    <span>
      {originalFormatted} → {formatted} at {rate}
    </span>
  );
}
