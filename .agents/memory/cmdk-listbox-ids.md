---
name: Cmdk listbox IDs
description: Accessible relationships when using cmdk CommandList inside a portaled picker.
---

Cmdk owns the rendered CommandList ID and may replace an `id` passed to the wrapper. Do not set `aria-controls` on an external trigger to a caller-generated ID unless it is the ID actually rendered on the listbox.

**Why:** A server-rendered option-list check showed that CommandList substituted its internal ID for the one passed as a prop, leaving an outer combobox trigger pointing to a nonexistent element.

**How to apply:** Let the cmdk search input manage its relationship with the listbox, give the input an accessible name, and make the outer trigger a named button with `aria-haspopup`/`aria-expanded` rather than inventing a listbox ID.