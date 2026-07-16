# fantasynowplus.com — Redesign v2 (A/B candidate)

A real visual departure from the current site, not just a recolor — built around the site's own broadcast/media identity (live video feed, ticker, stat widgets) on the official brand palette:

- Bright Orange `#FFA515` · Deep Blue `#002863` · Pure White `#FFFFFF` · Solid Black `#000000`
- Vibrant Red-Orange `#EA4E3D` · Light Gray `#F4F4F4` · Charcoal Gray `#606060` · Aqua Green `#42F4B0`

## What actually changed this pass

- **New hero**: real headline + eyebrow ("ON THE CLOCK") + subhead over a dark gradient scrim, framed with camera-viewfinder corner brackets — replaces the old bare image banner.
- **Hard-edged "broadcast tag" card system**: every card (trending, rankings, video, tools, staff) dropped its soft rounded corners for sharp edges + orange corner-bracket framing, done via layered CSS backgrounds — no HTML restructuring, so zero risk to the JS that targets these elements.
- **Condensed display type**: Barlow Condensed, bold, uppercase, tracked — used for all headings, nav, buttons, card headers. Big scale jump on page titles (`h1`/`h2`).
- **Animated nav underline** + a subtle scanline texture across the whole site for a "broadcast monitor" feel.
- **Section eyebrows** ("Trending Now," "Live Feed") added above key content blocks.
- **Live-pulse dot** on the ticker.
- Full color system carried through from v1 — all inline/hardcoded hex swapped for brand values.

## Still untouched

Every JS-driven widget (Sleeper trends, YouTube feed, rankings widget, the 3 roster/recap tools, mobile nav, the Join Our Team Formspree form) hooks into the exact same IDs, classes, and form field names as the live site. Nothing there was renamed.

## Testing this as an A/B candidate

1. Push this to its own repo (or overwrite the previous `redesign` repo/branch).
2. Enable GitHub Pages the same way as before (Settings → Pages → Deploy from branch → `main` / root).
3. Compare side-by-side with the live site for staff feedback.
