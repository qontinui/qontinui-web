import { SectionNotReady } from "../_components/SectionNotReady";

export default function TimelinePage() {
  return (
    <SectionNotReady
      sectionId="overview-timeline"
      willShow={[
        "Each phase as a bar, planned against actual, with the gate that ends it",
        "Milestones, holiday breaks and decision deadlines on the same calendar",
        "The forecast finish date, and how far it has moved",
      ]}
    />
  );
}
