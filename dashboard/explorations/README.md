# dashboard/explorations - three layout directions

Three answers to the same question: how do you lay out a live WiFi air monitor for
someone who checks it daily. All three keep the `DESIGN.md` system unchanged - warm
paper `#FFFFFF`, one orange accent `#F78522`, mono numerals with `tabular-nums`,
20px radius, quint easing. They differ only in **composition**.

All files are self-contained: inline CSS, no build step, no CDN, no external fonts
(system font stacks), no network requests. Open any of them directly in a browser.
Data is realistic and hand-authored (matches the cast in `server/scripts/seed-demo.js`):
plausible RSSI values, a hidden SSID shown as `""`, a 24h curve with a quiet night and a
busy evening. No lorem ipsum, no fabricated uptime claims.

| | **A - Operations console** | **B - Bento, one dominant metric** | **C - Editorial split** |
|---|---|---|---|
| **File** | `direction-a.html` | `direction-b.html` | `direction-c.html` |
| **Shape** | Single column, full-width stacked panels | 4-column asymmetric grid, hero tile 2x2 | Two columns: narrative left, data right |
| **First thing you read** | A 4-cell stat strip, then channel bars | Channel `6` at ~90px, the whole point of the page | A sentence: "Five APs are sharing channel 6" |
| **AP table** | Full-width table, all columns visible | Narrow scrolling list in the tall right rail | Full table, airy 13px row padding |
| **Channel bars** | Full width, threshold line drawn | Full width, no threshold line | Full width, inside the right column |
| **24h MACs** | Wide strip, big `214` on the right | Compact tile with sparkline | Sparkline + `214` block |
| **Empty/loading state** | Not shown | Not shown | **Yes** - toggle "Empty / loading" in the header |
| **Optimises for** | Scanning speed. Every fact in a predictable place; eyes learn one column and never hunt. | One decision. The crowded channel is unmissable at a glance, so the answer arrives before any reading. | Understanding. Explains *why* channel 6 matters, so a first-time visitor (a Stardance reviewer) gets the point without prior knowledge. |
| **What it costs** | Longest scroll. The most important number (peak channel) is one row down, not first. | Asymmetry needs care at narrow widths; the 4-col grid is the most fragile of the three when it collapses. | Most vertical space. A daily operator re-reading the same sentence every morning pays for words they already know. |
| **Density** | High | Medium-high | Low, deliberately |
| **Best width** | Any; happiest at 1024-1440px | 1200px+ | 900px+ |

## What every direction shares

- **Live indicator**: one double-halo pulse dot, the only ambient animation on the page.
  Gated behind `prefers-reduced-motion` with a gentler opacity fade, not zero motion.
- **Signal colour + label**: RSSI strength is shown as a coloured dot *and* the number,
  so meaning never rests on colour alone (WCAG 2.2 AA, DESIGN.md section 9).
- **Stale APs**: marked `missing` after 90s and dimmed, never removed (PRD US-2).
- **Hidden SSID**: rendered as italic "hidden network", never an empty cell.
- **MAC caveat**: the "counts MACs, not people" note is present in all three, as
  `meta.caveat` requires (PRD US-4).
- **Motion**: only `transform` and `opacity`, `transition-property` spelled out
  (never `transition: all`), entrances from `scale(0.95)` never `scale(0)`, hover
  effects inside `@media (hover: hover) and (pointer: fine)`.
- **Channel axis**: always 1-14. The ESP is 2.4 GHz only and cannot see 5 GHz, so no
  direction ever renders a channel above 14.

## Which I would ship for a daily-use operator tool

**Direction A**, with one transplant from B.

A daily tool is opened, read, and closed dozens of times a day. The operator is not
deciding whether they understand the page - they understood it on day one. What they
want is to see the state *fast*, and A's single predictable column is the fastest to
scan: the eye lands in the same place every time and the cost of re-orienting is zero.
B is more beautiful and better for the one-time reviewer, but its grid moves the
channel chart below the fold and reflows awkwardly on a phone, which is a real cost
every single day. C is the best *explanation* and the wrong *instrument* - it spends
screen space on prose a returning user has already internalised.

The transplant: pull B's oversized peak-channel number into A's stat strip, so the
single most actionable fact (which channel is crowded) leads the page while keeping
A's dense column beneath it. That gives a daily operator the answer first and the
evidence second, which is the right order for something used every morning.

B is the pick if the audience is a Stardance reviewer who will look once. C is the pick
if the product ever needs to teach, not just report.
