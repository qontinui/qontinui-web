/**
 * Element Types guideline section content.
 */

import { GuidelineSection } from "./GuidelineSection";
import { ElementTypeItem } from "./ElementTypeItem";
import { ELEMENT_TYPES } from "./annotation-guidelines-data";

export function ElementTypesSection() {
  return (
    <GuidelineSection title="2. Element Types">
      <div className="space-y-1">
        {ELEMENT_TYPES.map((element) => (
          <ElementTypeItem key={element.type} {...element} />
        ))}
      </div>
    </GuidelineSection>
  );
}
