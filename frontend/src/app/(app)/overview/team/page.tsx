import { SectionNotReady } from "../_components/SectionNotReady";

export default function TeamPage() {
  return (
    <SectionNotReady
      sectionId="overview-team"
      willShow={[
        "The roles the project needs and how much of each, phase by phase",
        "The people doing the work, and the time recorded against each phase",
      ]}
    />
  );
}
