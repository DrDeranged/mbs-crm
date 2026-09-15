# UI Overlays & Stacking Context Sweep

This file enumerates every fixed/absolute/portal element in `src/`, specifying the container it renders into and the `z-[...]` token used.

## Z-Index Tokens (Defined in `index.css`)
- `--z-deal-card-bg`: 0
- `--z-nav-menu`: 1
- `--z-hero-content`: 5
- `--z-deal-card-content`: 5
- `--z-header`: 10
- `--z-sidebar-border`: 15
- `--z-sidebar`: 20
- `--z-popover`: 30
- `--z-dialog`: 40
- `--z-dialog-popover`: 45
- `--z-toast`: 50

## Inventory of Elements

### App Layout & Globals
- **`src/App.tsx:186`** - Hero Content
  - Position: `relative z-[var(--z-hero-content)]`
  - Container: In flow / Main page
- **`src/components/app-shell.tsx:233`** - Desktop Sidebar
  - Position: `fixed md:inset-y-0 md:left-0 md:z-[var(--z-sidebar)]`
  - Container: In flow / App Wrapper
- **`src/components/ui/sidebar.tsx:232`** - Mobile Sidebar Container
  - Position: `fixed inset-y-0 z-[var(--z-sidebar)]`
  - Container: Portal (`Sheet` component)
- **`src/components/ui/sidebar.tsx:295`** - Sidebar Rail Drag Handle
  - Position: `absolute inset-y-0 z-[var(--z-sidebar-border)]`
  - Container: Sidebar
- **`src/components/softphone-widget.tsx:477`** - Softphone Trigger Button
  - Position: `fixed bottom-6 right-6 z-[var(--z-popover)]`
  - Container: In flow (Document body)

### Notifications
- **`src/components/notification-bell.tsx:191`** - Mobile Notification Sheet
  - Position: `fixed bottom-0 z-[var(--z-popover)]` (via `SheetContent`)
  - Container: Portal (Document body)
- **`src/components/notification-bell.tsx:210`** - Desktop Notification Popover
  - Position: `absolute z-[var(--z-popover)]` (via `PopoverContent`)
  - Container: Portal (Document body)

### Pages
- **`src/pages/deals.tsx:521`** - Deal Card Background Link
  - Position: `absolute inset-0 z-[var(--z-deal-card-bg)]`
  - Container: Deal Card
- **`src/pages/deals.tsx:523`** - Deal Card Content
  - Position: `relative z-[var(--z-deal-card-content)]`
  - Container: Deal Card
- **`src/pages/new-deal.tsx:103`** - New Deal Sticky Header
  - Position: `sticky top-0 z-[var(--z-header)]`
  - Container: Page Scroll Area
- **`src/pages/deal-detail.tsx:137`** - Deal Detail Sticky Header
  - Position: `sticky top-0 z-[var(--z-header)]`
  - Container: Page Scroll Area
- **`src/pages/deal-detail.tsx:299`** - Deal Detail Activity Item
  - Position: `relative z-[var(--z-header)]`
  - Container: Activity List
- **`src/pages/leads.tsx:1089`** - Bulk Actions Floating Bar
  - Position: `fixed bottom-6 z-[var(--z-popover)]`
  - Container: Main Page Scroll Area
- **`src/pages/lead-detail/header.tsx:81`** - Lead Detail Sticky Header
  - Position: `sticky top-0 z-[var(--z-header)]`
  - Container: Page Scroll Area

### Dialogs & Sheets (z-[var(--z-dialog)])
All Radix Dialog primitives render into a `<Portal>` (Document body) and use `--z-dialog`.
- **`src/components/ui/dialog.tsx:22`** - Dialog Overlay
- **`src/components/ui/dialog.tsx:39`** - Dialog Content
- **`src/components/ui/sheet.tsx:24`** - Sheet Overlay
- **`src/components/ui/sheet.tsx:34`** - Sheet Content
- **`src/components/ui/drawer.tsx:29`** - Drawer Overlay
- **`src/components/ui/drawer.tsx:44`** - Drawer Content
- **`src/components/ui/alert-dialog.tsx:19`** - Alert Dialog Overlay
- **`src/components/ui/alert-dialog.tsx:37`** - Alert Dialog Content

### Popovers, Selects & Tooltips (z-[var(--z-popover)] or z-[var(--z-dialog-popover)])
All Radix ephemeral floating elements render into a `<Portal>` (Document body).
- **`src/components/ui/popover.tsx:22`** - Popover Content
- **`src/components/ui/dropdown-menu.tsx:50,68`** - Dropdown Menu Content
- **`src/components/ui/select.tsx:78`** - Select Content
- **`src/components/ui/tooltip.tsx:23`** - Tooltip Content
- **`src/components/ui/hover-card.tsx:19`** - Hover Card Content
- **`src/components/ui/context-menu.tsx:47,63`** - Context Menu Content
- **`src/components/ui/menubar.tsx:95,118`** - Menubar Content
- **`src/components/ui/navigation-menu.tsx:107`** - Navigation Menu Indicator (`z-[var(--z-nav-menu)]`)

*Note: Nested selects within Dialogs (`workflow-rules.tsx`, `email-templates.tsx`, `flyer-templates.tsx`, `lender-management.tsx`, `drip-sequences.tsx`, `edit-dialog.tsx`) use `z-[var(--z-dialog-popover)]` to ensure they render above the `40` dialog layer.*

### Toasts
- **`src/components/ui/toast.tsx:17`** - Toast Viewport (`z-[var(--z-toast)]`)
  - Container: Document body
- **`src/components/ui/sonner.tsx:15`** - Sonner Toaster
  - Container: Document body
  - Inline `style.zIndex` uses `var(--z-toast)`, overriding Sonner's internal default.