---
name: design-taste-frontend
description: "Anti-slop frontend design system guidelines for modern typography, harmonious color schemes, glassmorphism, dynamic spacing, smooth micro-animations, and visual polish."
---

# Design Taste Frontend - Anti-Slop Guidelines

When creating or modifying frontend user interfaces, strictly apply these high-taste design rules to prevent generic, boring "AI slop" UIs.

## 1. Color System & Aesthetics
- **Never use default primary colors** (pure red #ff0000, pure blue #0000ff, plain gray #888888).
- **Curated Palettes**: Use rich HSL or `color-mix(in srgb, ...)` color tokens with high contrast and depth.
- **Glassmorphism & Depth**: Combine subtle translucent backgrounds (`rgba(..., 0.7)`), `backdrop-filter: blur(...)`, floating shadows (`box-shadow`), and 1px delicate translucent borders.

## 2. Typography & Hierarchies
- **Font Selection**: Use modern web fonts (e.g. Inter, Outfit, Iowan Old Style, Baskerville, Segoe UI Variable) with proper fallbacks.
- **Scale & Contrast**: Create intentional contrast between headings (`h1`, `h2`) and body text. Use `letter-spacing`, `line-height`, and uppercase `eyebrows` with tracking for metadata tags.

## 3. Spacing Rhythm & Layout
- **Dynamic Layouts**: Avoid static pixel calculations. Use CSS Grid, Flexbox, `clamp()`, and fluid sizing.
- **Whitespace**: Give elements room to breathe. Maintain consistent padding scales (8px, 12px, 16px, 24px, 36px, 48px).

## 4. Micro-Animations & Interactivity
- **Hover & Active States**: Provide instant visual feedback for buttons, cards, and input fields using smooth cubic-bezier transitions (`transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1)`).
- **Pop & Elevation**: Cards and interactive elements should respond with subtle scale (`scale(1.02)`), shadow depth changes, or glow animations when hovered or active.

## 5. Mobile & Responsive Refinement
- **Touch Targets**: Ensure touch targets are at least 40px × 40px on small screens.
- **Fluid Breakpoints**: Use CSS `@media (max-width: ...)` queries to adapt grid columns (6 -> 4 -> 2) seamlessly.
