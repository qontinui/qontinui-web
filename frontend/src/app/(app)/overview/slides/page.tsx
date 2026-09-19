import { SectionNotReady } from "../_components/SectionNotReady";

export default function SlidesPage() {
  return (
    <SectionNotReady
      sectionId="overview-slides"
      willShow={[
        "Presentation decks built from the project's own figures and timeline",
        "A presenter view with speaker notes, and a printable version",
      ]}
    />
  );
}
