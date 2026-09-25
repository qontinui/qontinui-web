import { SectionNotReady } from "../_components/SectionNotReady";

export default function WikiPage() {
  return (
    <SectionNotReady
      sectionId="overview-wiki"
      willShow={[
        "The project's terms and topics, explained in plain language",
        "Links between topics, so one explanation leads to the next",
      ]}
    />
  );
}
