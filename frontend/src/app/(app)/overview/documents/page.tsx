import { SectionNotReady } from "../_components/SectionNotReady";

export default function DocumentsPage() {
  return (
    <SectionNotReady
      sectionId="overview-documents"
      willShow={[
        "Briefs, delivery plans, contracts and reports, uploaded or written here",
        "Each document's status, owner and version history",
      ]}
    />
  );
}
