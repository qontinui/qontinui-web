import { ReactNode } from "react";

interface ExampleSectionProps {
  title: string;
  children: ReactNode;
}

export function ExampleSection({ title, children }: ExampleSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </div>
  );
}
