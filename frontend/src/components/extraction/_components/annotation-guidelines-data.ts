/**
 * Static data for the Annotation Guidelines Dialog.
 */

export interface ElementTypeItemData {
  type: string;
  description: string;
  color?: string;
}

export interface KeyboardShortcutData {
  label: string;
  shortcut: string;
}

export const ELEMENT_TYPES: ElementTypeItemData[] = [
  {
    type: "Button",
    description:
      "Interactive clickable elements that trigger actions, such as submit buttons, toggle buttons, or action buttons.",
    color: "#3B82F6",
  },
  {
    type: "Input Field",
    description:
      "Text input areas where users can type, including single-line inputs, password fields, and search boxes.",
    color: "#10B981",
  },
  {
    type: "Link",
    description:
      "Clickable navigation elements that lead to other pages or sections, typically styled as text with underlines or distinct colors.",
    color: "#8B5CF6",
  },
  {
    type: "Icon",
    description:
      "Visual indicators or icon buttons that convey meaning or provide clickable actions, such as menu icons, status indicators, or action icons.",
    color: "#F59E0B",
  },
  {
    type: "Label/Text",
    description:
      "Static text content including headings, paragraphs, captions, and any non-interactive text displayed on the interface.",
    color: "#6B7280",
  },
  {
    type: "Container",
    description:
      "Grouping elements that organize other UI components, such as cards, panels, sections, or modal dialogs.",
    color: "#EC4899",
  },
  {
    type: "Checkbox",
    description:
      "Toggle inputs that allow users to select multiple options, represented by a square box that can be checked or unchecked.",
    color: "#14B8A6",
  },
  {
    type: "Radio Button",
    description:
      "Single-select options within a group, represented by circular buttons where only one can be selected at a time.",
    color: "#F97316",
  },
  {
    type: "Dropdown",
    description:
      "Select menus that expand to show a list of options, allowing users to choose one or more items from the list.",
    color: "#06B6D4",
  },
  {
    type: "Menu",
    description:
      "Navigation menus including horizontal nav bars, vertical sidebars, hamburger menus, and context menus.",
    color: "#84CC16",
  },
  {
    type: "Tab",
    description:
      "Tab navigation elements that switch between different views or content sections within the same container.",
    color: "#A855F7",
  },
  {
    type: "Image",
    description:
      "Visual content including photos, illustrations, diagrams, and any non-icon graphical elements.",
    color: "#EF4444",
  },
  {
    type: "Other",
    description:
      "Miscellaneous elements that do not fit into the above categories, such as sliders, progress bars, or custom widgets.",
    color: "#78716C",
  },
];

export const KEYBOARD_SHORTCUTS: KeyboardShortcutData[] = [
  { label: "Select Tool", shortcut: "V" },
  { label: "Draw Box Tool", shortcut: "B" },
  { label: "Delete Tool", shortcut: "D" },
  { label: "Pan Tool", shortcut: "H" },
  { label: "Undo", shortcut: "Ctrl+Z" },
  { label: "Redo", shortcut: "Ctrl+Y" },
  { label: "Select All", shortcut: "Ctrl+A" },
  { label: "Deselect", shortcut: "Esc" },
  { label: "Copy", shortcut: "Ctrl+C" },
  { label: "Cut", shortcut: "Ctrl+X" },
  { label: "Paste", shortcut: "Ctrl+V" },
  { label: "Save", shortcut: "Ctrl+S" },
  { label: "Toggle Grid", shortcut: "Ctrl+G" },
];
