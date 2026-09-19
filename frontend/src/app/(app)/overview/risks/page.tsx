import { SectionNotReady } from "../_components/SectionNotReady";

export default function RisksPage() {
  return (
    <SectionNotReady
      sectionId="overview-risks"
      willShow={[
        "The risk register: what could go wrong, its consequence and its mitigation",
        "Open decisions, and the phase or date each one is needed by",
      ]}
    />
  );
}
