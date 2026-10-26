# Toolcraft components

The files in this directory are adapted from [Toolcraft](https://toolcraft.sh)
(`pixel-point/toolcraft`, MIT, see `LICENSE.md`), copied from
`starter/src/toolcraft` at commit `4952c4a59dc85a5a29079d81c8666c4898461ab6`.

Only the pieces the workflow viewer uses are vendored:

| File | Toolcraft source |
| --- | --- |
| `button.tsx` | `ui/components/primitives/button.tsx`, `ui/components/panel/panel-icon-button.tsx` |
| `segmented-control.tsx` | `ui/components/controls/segmented/segmented-control.tsx`, `ui/components/primitives/toggle-group.tsx`, `toggle.tsx` |
| `switch.tsx` | `ui/components/primitives/switch.tsx` |
| `panel.tsx` | `ui/components/control-layout/control-section-title.tsx` and the panel surface classes |
| `toolbar.tsx` | `runtime/react/app-shell/toolbar-panel.tsx` |
| `layers-panel.tsx` | `runtime/react/layers/layers-panel-row.tsx` |
| `canvas.tsx` | `runtime/react/canvas/canvas-shell.tsx`, `use-canvas-viewport-interactions.ts` |
| `keyframes.tsx` | `runtime/react/timeline/timeline-keyframe-row.tsx`, `timeline-icon-button.tsx` |

Changes from upstream:

- Toolcraft's runtime store, history, persistence, drag-reorder, and media
  layers are removed. Each component takes plain props.
- Base UI primitives are replaced with native elements that follow the same
  WAI-ARIA patterns (radio group, switch, listbox), so the docs app adds no
  dependency. Tooltips become `title` attributes.
- Phosphor icons are replaced with the `lucide-react` icons the docs app
  already ships.
- Toolcraft's theme variables (`--foreground`, `--accent`, `--border`, ...)
  are mapped onto the docs site's Fumadocs tokens by the `.toolcraft` class in
  `src/styles/app.css`, so light and dark mode follow the site.
