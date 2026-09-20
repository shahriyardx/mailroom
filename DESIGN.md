# Design system

The plan for the interface, written down so it survives a context reset.

## Direction

Light, airy, professional SaaS. The reference is a three-pane mail client:
white canvas, a quiet sidebar, generous whitespace, soft rounded corners, one
warm accent used sparingly. Nothing decorative, nothing that reads as a
template.

Not: dense terminal aesthetics, hairline-everything, mono labels everywhere.
That was the previous direction and it is being replaced.

## Rules

1. **Own the components.** No shadcn. Radix primitives supply behaviour
   (dialog, dropdown, popover, tooltip, tabs, checkbox, switch, select);
   every pixel of styling is ours, in `src/components/kit/`.
2. **Pure Tailwind.** No CSS-in-JS, no component library styles. Tokens live
   in `globals.css` under `@theme`; components compose utilities.
3. **One accent.** It signals unread, the primary action and focus. The
   active navigation row is a neutral fill with a heavier weight, not an
   accent tint, so the accent keeps one meaning.
4. **Soft geometry.** 10-14px radii on surfaces, full pills for status and
   primary buttons. No hard corners.
5. **Type earns hierarchy.** Weight and size, not colour alone. Mono is
   reserved for values you read as data: addresses, DNS records, ids.
6. **Depth is rare.** A soft shadow means "this floats". Everything else uses
   background steps and a hairline.

## Layout

```
┌────────────┬─────────────────────────────────────────────┐
│ sidebar    │ scope name, count                  header   │
│ 240px      ├───────────────────┬─────────────────────────┤
│ wordmark   │ tabs, refresh     │ toolbar, reply          │
│ search /   ├───────────────────┤                         │
│ compose    │ rows: avatar,     │ sender, recipients      │
│ folders    │ sender + time,    │ subject, body           │
│ mailboxes  │ subject + dot,    │ attachment cards        │
│ labels     │ snippet           │ replies as panels       │
│ account    │ 392-424px         │ fills                   │
└────────────┴───────────────────┴─────────────────────────┘
```

The application fills the window: no outer gutter, no outer corners. The
view is named once, in a header spanning both columns.

Below `lg` the reading pane takes over the screen. Below `md` the sidebar
becomes a drawer. Both behaviours already exist and must be kept.

## Component inventory

Build in `src/components/kit/`, each a thin styled wrapper over a Radix
primitive or a plain element:

| Component | Primitive | Notes |
| --- | --- | --- |
| Button | — | solid / soft / ghost / outline, sm-md-lg, pill option |
| IconButton | — | square, 32/36px, tooltip-ready |
| Input, Textarea | — | soft filled background, focus ring from accent |
| Field | — | label, hint, error, wraps any control |
| Select | `@radix-ui/react-select` | |
| Checkbox, Switch | `react-checkbox`, `react-switch` | |
| Tabs | `react-tabs` | underline style for the list header |
| Dialog, Sheet | `react-dialog` | Sheet is Dialog with side positioning |
| DropdownMenu | `react-dropdown-menu` | |
| Tooltip | `react-tooltip` | |
| Popover | `react-popover` | |
| Avatar | `react-avatar` | initials fallback, stable colour per address |
| Badge / Pill | — | status colours: ok, warn, danger, neutral |
| Card, Panel | — | settings sections |
| Separator | `react-separator` | |
| ScrollArea | `react-scroll-area` | optional, only where custom bars help |
| EmptyState, Skeleton | — | what a pane shows with nothing to show |
| Toaster | `sonner` | queueing and timers theirs, styling ours |

## Migration

Done. The tokens were retuned first, the kit was built on Radix, every
screen moved across, and `src/components/ui/` went away with the shadcn,
Base UI and `cn` packages.

## What must not regress

- Mobile: sidebar drawer, list/reading-pane swap, full-width composer.
- Keyboard: `c` compose, `/` search, `g` then a letter to jump folder.
- Theme: light and dark both work, chosen before first paint.
- Density: a conversation row stays three lines — sender and time, subject
  with the unread dot, then the snippet.
- Row actions appear on hover in the timestamp's place; the avatar turns
  into its checkbox when you reach for it.
