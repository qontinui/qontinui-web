# Early Access Warning Components

**Created:** November 9, 2025
**Purpose:** Manage user expectations during early access period (until February 2026)
**Reference:** `/mnt/c/Users/Joshua/OneDrive/Qontinui BusDev/05-development/EARLY-ACCESS-WARNING-IMPLEMENTATION.md`

---

## Overview

These components implement a three-touchpoint strategy to inform users about Qontinui's early access status and encourage regular exports to prevent data loss.

**Key Messages:**

1. Early access is a FEATURE, not a limitation
2. Full functionality available NOW
3. Export regularly (like "Save")
4. JSON backward compatibility guaranteed

---

## Components

### 1. EarlyAccessSignupWarning

**Location:** `/components/early-access/EarlyAccessSignupWarning.tsx`

**Purpose:** Warn users BEFORE account creation

**Features:**

- Prominent blue alert box (non-dismissible)
- Four key points with icons:
  - ✅ Fully functional
  - ⚠️ Breaking changes possible
  - 💾 Export regularly
  - 🔄 JSON backward compatible
- "Learn More" expandable FAQ modal
- Positive framing ("early access" not "beta")

**Usage:**

```tsx
import { EarlyAccessSignupWarning } from "@/components/early-access";

// In AuthDialog or signup form
<EarlyAccessSignupWarning />;
```

**Implementation:**

- Already integrated into `AuthDialog` component (signup tab)
- Shows automatically in the register tab content
- No state management needed (always visible in signup)

---

### 2. EarlyAccessBanner

**Location:** `/components/early-access/EarlyAccessBanner.tsx`

**Purpose:** Persistent reminder on dashboard

**Features:**

- Slim, non-intrusive banner at top of dashboard
- Shows: "🚀 Early Access | Launches Feb 2026 | Export your work regularly"
- "Export" button (wire up to export functionality)
- "Close" button (dismisses for session only)
- Uses `sessionStorage` - reappears on next login
- Blue gradient styling matching brand

**Usage:**

```tsx
import { EarlyAccessBanner } from "@/components/early-access";

<EarlyAccessBanner onExport={handleExportFunction} />;
```

**Props:**

- `onExport?: () => void` - Callback when Export button clicked

**Implementation:**

- Integrated into dashboard page at the top
- Currently shows toast message when export clicked
- TODO: Wire up to actual export functionality when available

---

### 3. EarlyAccessWelcomeModal

**Location:** `/components/early-access/EarlyAccessWelcomeModal.tsx`

**Purpose:** One-time welcome for new users

**Features:**

- Full-screen centered modal
- Shows on first login only (uses `localStorage`)
- Four key points with visual emphasis:
  - ✅ Everything works
  - 💾 Export JSON regularly
  - ⚠️ Breaking changes may happen
  - 🔄 JSON always imports
- "Pro Tip" section highlighting export workflow
- Two action buttons:
  - "Show Me Export" - highlights export feature
  - "Got it, let's build!" - dismisses modal
- Beautiful gradient background with glow effects

**Usage:**

```tsx
import { EarlyAccessWelcomeModal } from "@/components/early-access";

<EarlyAccessWelcomeModal
  open={showModal}
  onClose={() => setShowModal(false)}
  onShowExport={handleShowExportFeature}
/>;
```

**Props:**

- `open?: boolean` - Controlled open state (optional)
- `onClose?: () => void` - Callback when modal closed
- `onShowExport?: () => void` - Callback for "Show Me Export" button

**Implementation:**

- Integrated into dashboard page
- Auto-shows for new users (created < 5 min ago)
- Delays 3 seconds if onboarding modal shows first
- Stores "has shown" state in `localStorage`

---

## Integration Points

### AuthDialog (`/components/auth-dialog.tsx`)

**Changes:**

```tsx
// Import added
import { EarlyAccessSignupWarning } from "@/components/early-access/EarlyAccessSignupWarning";

// Added in register TabsContent
<TabsContent value="register">
  <EarlyAccessSignupWarning />
  <form>...</form>
</TabsContent>;
```

**Result:** Warning now shows above signup form automatically

---

### Dashboard (`/app/(app)/dashboard/page.tsx`)

**Changes:**

1. **Imports:**

```tsx
import {
  EarlyAccessBanner,
  EarlyAccessWelcomeModal,
} from "@/components/early-access";
```

2. **State:**

```tsx
const [showEarlyAccessWelcome, setShowEarlyAccessWelcome] = useState(false);
```

3. **Logic:**

```tsx
// Auto-show welcome modal for new users
useEffect(() => {
  if (user && !authLoading && isNewUser()) {
    const timer = setTimeout(
      () => {
        setShowEarlyAccessWelcome(true);
      },
      hasCompletedWelcome ? 500 : 3000
    );
    return () => clearTimeout(timer);
  }
}, [user, authLoading, hasCompletedWelcome]);
```

4. **Handlers:**

```tsx
const handleExport = () => {
  toast.info("To export, use the export icon in the sidebar or the Export button at the top of the canvas");
};

const handleShowExport = () => {
  setShowEarlyAccessWelcome(false);
  handleExport();
};
```

5. **Render:**

```tsx
// At top of page (before header)
<EarlyAccessBanner onExport={handleExport} />

// At bottom with other modals
<EarlyAccessWelcomeModal
  open={showEarlyAccessWelcome}
  onClose={() => setShowEarlyAccessWelcome(false)}
  onShowExport={handleShowExport}
/>
```

---

## Storage Keys

### LocalStorage

- `qontinui-early-access-welcome-shown` - Tracks if welcome modal has been shown

### SessionStorage

- `qontinui-early-access-banner-dismissed` - Tracks if banner dismissed this session

---

## Design Principles

### Colors

- **Primary:** Blue (#3B82F6) - Early access badge, positive messaging
- **Success:** Green (#10B981) - "Works now", backward compatibility
- **Warning:** Yellow (#EAB308) - Breaking changes (neutral, not scary)
- **Danger:** Avoid red - we want positive framing

### Typography

- **Headers:** Bold, 18-24px
- **Body:** 14-16px, readable
- **Icons:** 20-24px (visual anchors)

### Tone

- ✅ "Early access" (positive, exclusive)
- ✅ "Join as an early tester" (community)
- ✅ "Help shape the product" (agency)
- ❌ "Beta" (sounds unstable)
- ❌ "Work in progress" (unfinished)
- ❌ "Use at your own risk" (scary)

---

## Testing Checklist

### Before Sunday HN Post:

- [ ] **Signup Warning**
  - [ ] Shows in signup tab (not login tab)
  - [ ] "Learn More" modal opens/closes correctly
  - [ ] Mobile responsive
  - [ ] Copy matches implementation guide exactly

- [ ] **Dashboard Banner**
  - [ ] Shows at top of dashboard
  - [ ] Export button shows toast (or triggers export)
  - [ ] Close button dismisses banner
  - [ ] Reappears after closing browser and logging back in
  - [ ] Mobile responsive (stacks vertically)

- [ ] **Welcome Modal**
  - [ ] Shows once on first login for new users
  - [ ] Doesn't show again after dismissal
  - [ ] "Show Me Export" button works
  - [ ] "Got it" button dismisses modal
  - [ ] Doesn't conflict with onboarding modal
  - [ ] Mobile responsive

- [ ] **General**
  - [ ] All components match brand colors
  - [ ] No TypeScript errors
  - [ ] No console errors
  - [ ] Accessible (keyboard navigation, screen readers)

---

## Future Enhancements (Post-HN)

1. **Export Integration**
   - Wire banner Export button to actual export dialog
   - Show last export timestamp ("Last exported: 2 hours ago")
   - Highlight export feature when "Show Me Export" clicked

2. **Advanced Reminders**
   - Auto-prompt to export after 30 min of changes
   - Browser localStorage backup as safety net
   - Weekly email reminder to export

3. **Analytics**
   - Track % of users who export at least once
   - Average time to first export
   - Banner dismissal rate
   - Modal completion rate

4. **A/B Testing**
   - Test different warning tones
   - Test banner visibility strategies
   - Test call-to-action wording

---

## Removal (February 2026)

When launching official version:

1. Remove components from dashboard:

```tsx
// Delete these lines
<EarlyAccessBanner onExport={handleExport} />
<EarlyAccessWelcomeModal ... />
```

2. Remove signup warning from AuthDialog:

```tsx
// Delete this line
<EarlyAccessSignupWarning />
```

3. Add launch celebration modal (optional)
4. Thank early access users in announcement

---

## Files Created

```
/components/early-access/
├── EarlyAccessSignupWarning.tsx    (Signup page warning + FAQ)
├── EarlyAccessBanner.tsx           (Dashboard banner)
├── EarlyAccessWelcomeModal.tsx     (First login modal)
├── index.ts                        (Exports)
└── README.md                       (This file)
```

## Files Modified

```
/components/auth-dialog.tsx         (Added signup warning)
/app/(app)/dashboard/page.tsx       (Added banner + welcome modal)
```

---

## Questions?

See the main implementation guide:
`/mnt/c/Users/Joshua/OneDrive/Qontinui BusDev/05-development/EARLY-ACCESS-WARNING-IMPLEMENTATION.md`
