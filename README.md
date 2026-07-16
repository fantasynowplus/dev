# fantasynowplus.com — Redesign (A/B candidate)

Full visual redesign of the FantasyNow+ site, rebuilt on the official brand palette:

- Bright Orange `#FFA515`
- Deep Blue `#002863`
- Pure White `#FFFFFF`
- Solid Black `#000000`
- Vibrant Red-Orange `#EA4E3D`
- Light Gray `#F4F4F4`
- Charcoal Gray `#606060`
- Aqua Green `#42F4B0`

## What changed

- **Color system**: every hardcoded color across all 10 CSS files and inline page styles now traces back to the 8 official brand hex values (see `css/style.css` `:root` block).
- **Typography**: added Barlow Condensed as a display face for headlines, nav, and card headers — Inter stays as the body font, unchanged.
- **Signature look**: sports-broadcast "notched tag" corners on card headers (trending, rankings, footer), and a pulsing "LIVE" dot on the news ticker — nods to the site's broadcast/lower-third content.
- **Structure, functionality, and every page's content are untouched.** All JS-driven widgets (Sleeper trending, YouTube feed, rankings widget, the three roster/recap tools, mobile nav) still hook into the exact same element IDs and classes — nothing there was renamed or restructured.

## Still Jekyll — on purpose

This keeps the `_includes/header.html` and `_includes/footer.html` pattern. GitHub Pages builds Jekyll automatically server-side, so there's no local build step for you — it's the right tool for keeping header/footer in sync across 10 pages, and ditching it would mean either copy-pasting the header everywhere or a client-side include that flashes unstyled content on load.

## Testing this as an A/B candidate

1. Push this to its own repo (or a branch) so it doesn't touch the live `fantasynowplus.github.io` site.
2. Enable GitHub Pages on it the same way as before (Settings → Pages → Deploy from branch → `main` / root).
3. You'll get a separate preview URL to show staff side-by-side with the current live site.
