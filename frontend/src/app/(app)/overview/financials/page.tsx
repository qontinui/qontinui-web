import { SectionNotReady } from "../_components/SectionNotReady";

export default function CostsPage() {
  return (
    <SectionNotReady
      sectionId="overview-costs"
      willShow={[
        "What the project has actually cost, month by month and by service",
        "How that compares with the project's estimate, phase by phase",
        "Where each figure comes from, and when it was last updated",
      ]}
    />
  );
}
