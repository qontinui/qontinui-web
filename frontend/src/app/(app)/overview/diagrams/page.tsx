import { SectionNotReady } from "../_components/SectionNotReady";

export default function DiagramsPage() {
  return (
    <SectionNotReady
      sectionId="overview-diagrams"
      willShow={[
        "High-level pictures of how the system fits together",
        "Each diagram with a short explanation, ready to download",
      ]}
    />
  );
}
