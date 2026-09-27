---
inclusion: fileMatch
fileMatchPattern: ["**/*.tsx"]
---
# UI Rules (Strictly shadcn/ui)

- Registry components only, added with `pnpm dlx shadcn@latest add <name>`; never hand-written components/ui files.
- Base UI APIs: `render` not `asChild`; `Select` with `items`; `ToggleGroup` and `Accordion` with `multiple` and array values; single `Slider` takes a number; toasts via `toast.add` from `@/components/ui/toast`.
- Semantic tokens only (`bg-background`, `text-muted-foreground`, `bg-primary`, `var(--chart-n)`); no raw palette classes, no hex, no manual `dark:` overrides. Extra intents: `warning` and `success` tokens and Badge/Alert variants only.
- Built-in variants and sizes before className; className for layout only; `cn()` from "cn"; `flex gap-*` not `space-*`; `size-*` for squares.
- Forms: `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, `FieldError` with React Hook Form `Controller` and Zod; `InputGroup` for adorned inputs.
- Lists: `Item`/`ItemGroup`; empty states: `Empty`; loading: `Skeleton`; status: `Badge` with lucide icon and sr-only text; dividers: `Separator`; shortcuts: `Kbd`.
- Overlays: Dialog (task), AlertDialog (destructive), Sheet (detail and filters), Drawer (mobile), Popover (small), Tooltip (hint); every overlay has a Title.
- Typography recipes only; Title Case for titles, headings, and button labels; sentence case body; no em or en dashes in user-facing copy.
- Icons from lucide-react only with `data-icon="inline-start|inline-end"` and no manual sizing.
- WCAG 2.2 AA: labels on icon buttons, keyboard reachable, visible focus, reduced motion respected, never color alone.
