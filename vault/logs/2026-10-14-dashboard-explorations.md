# 2026-10-14 - Dashboard design explorations (Fasa 3 kickoff)

> Project: ArsyWatch · Phase: Fasa 3 (dashboard) · Session: 3 design directions
> Vault: `C:\Users\User\Downloads\ArsyWatch\vault\` (project-specific, never mafcloud)

## What was asked

"Terokai dulu" - explore dashboard directions before committing. Three genuinely
different compositions, all keeping the DESIGN.md system unchanged. Load four skills
(`impeccable`, `emil-design-eng`, `superdesign`, `ui-taste`), read `DESIGN.md` and the
frozen `docs/api.md` first.

## Skills loaded

| Skill | Status | What it contributed |
|---|---|---|
| `ui-taste` | loaded | `reference/operate.md` - "match density to the work", trace one task, distinguish empty vs no-match |
| `emil-design-eng` | loaded | easing curves, `scale(0.95)` not `scale(0)`, `<300ms`, hover behind `(hover:hover) and (pointer:fine)` |
| `superdesign` | loaded | design-thinking-before-implementation framing |
| `impeccable` | **NOT INSTALLED** | referenced in global CLAUDE.md but absent from `~/.claude/skills/` |

`impeccable` missing is worth noting - the global CLAUDE.md treats it as the flagship
standard but it is not on disk. Either install it or drop the reference.

## Deliverables

```
dashboard/explorations/
  direction-a.html   17.6 KB  Operations console - single column, dense
  direction-b.html   15.2 KB  Bento - 4-col asymmetric grid, dominant channel number
  direction-c.html   19.7 KB  Editorial split - narrative left, data right, + empty state
  README.md           4.8 KB  comparison table + recommendation
```

All self-contained: inline CSS, no build, no CDN, no external fonts, no network calls.

## The three directions

- **A - Operations console.** One predictable column. 4-cell stat strip, then channel
  bars, then full-width AP table, then 24h MAC strip. Optimises for scanning speed.
- **B - Bento.** 4-col grid, hero tile 2x2 holding channel `6` at ~90px. The answer
  arrives before any reading. Optimises for one decision.
- **C - Editorial split.** Two columns: a sentence ("Five APs are sharing channel 6")
  on the left, data blocks on the right. The only direction that shows an empty/loading
  state. Optimises for understanding.

## Recommendation

**Ship A**, transplant B's oversized peak-channel number into A's stat strip. A daily
tool is opened dozens of times; the operator already understands it and wants state
fast. A's single column is the fastest to re-scan. B is prettier but moves the channel
chart below the fold and reflows awkwardly on mobile - a cost paid every day. C is the
best explanation and the wrong instrument.

## Verification done (not assumed)

- Programmatic ban scan on all 3 HTML files: zero hits for Inter/Roboto/Arial/Open Sans/
  Helvetica, em-dash, `transition: all`, `transition-property: all`, `scale(0)`,
  emoji, purple/blue gradients, `backdrop-filter`, glassmorphism, channel > 14,
  fabricated `99.x%`. All required tokens present.
- Rendered each in Chrome via DevTools MCP and read the screenshots. Found and fixed
  two real bugs:
  1. **Direction B** - bento tiles collided. The hero spanned rows 1-2 while the fact
     tiles also sat in row 2, so they overlapped. Fixed with explicit
     `grid-template-rows` + explicit row/column placement per tile, and rewrote the
     responsive collapse to clear placement.
  2. **Direction C** - the empty state never appeared. `.state{display:none}` overrode
     the `body[data-view="empty"] .empty-only{display:block}` rule. Removed the stray
     class. Also added a `.tbl-scroll` wrapper: the AP table overflowed the page at
     320px because C, unlike A, had no horizontal scroll container.
- 320px viewport test on all three: no page-level horizontal overflow after the fixes.
- Zero console errors/warnings on all three pages.

## Open items / handoff

1. **Stray directory left behind.** `C:\Users\User\arsywatch-vault\` was created by a
   `graphify export obsidian --dir` call this session before the canonical path was
   confirmed. It is a duplicate (740 files, mtime 20:19:52, all machine-generated,
   no user content). The sandbox hook blocks `rm -rf`, so it was left in place.
   Safe to delete manually. Rollback if ever needed:
   `py -m graphify export obsidian --dir C:/Users/User/arsywatch-vault`
2. `dashboard/explorations/` is not yet wired to the real API. These are static
   compositions with hand-authored data matching `server/scripts/seed-demo.js`.
3. Next: pick a direction, then build the real Next.js dashboard (Fasa 3, 26 Okt).

## graphify

- Rebuilt after adding the dashboard files: **707 nodes, 1142 edges, 41 communities**.
- Obsidian vault re-exported to the canonical in-repo path `vault/`.
- `graphify-out/` is gitignored (rebuildable); `vault/` is **not** gitignored, so it
  will be committed unless the user decides otherwise.

### The vault-inside-root problem (found and fixed)

`vault/` sits inside the scanned root, so graphify was indexing **its own export**:
every source file appeared twice (once real, once as a derived note), and the vault
grew to 748 notes for a 27-file repo. Circular and noisy.

Fix: added `.graphifyignore` at the repo root excluding `vault/` and `graphify-out/`.
Rebuilt with `graphify update . --force`. Graph is now **200 nodes, 389 edges,
15 communities**, zero vault-derived nodes - source only. Verified by scanning every
node for a `vault` path (0 matches).

Re-exporting then pruned the vault from 748 to 229 notes, keeping the 8 duplicate
artifacts (`_1`/`_2` suffixes) that graphify creates for colliding labels.

**Nothing hand-written was lost.** Four files disappeared in the prune
(`Apa yang berlaku hari ini.md`, `1. Kontrak API (docsapi.md).md`, `2. Server.md`,
`2026-10-14-devlog-01.md`) but each was a graphify derivative containing only a
`## Connections` stub pointing back at `vault/logs/2026-10-14-devlog-01.md`. The real
hand-written devlog (116 lines, full prose) is intact at `vault/logs/`. Verified by
reading it end to end.

Lesson: never export a vault into the root graphify scans. Use `.graphifyignore`, or
export outside the repo. Also: `graphify export obsidian` prunes notes for nodes it
no longer sees - safe for derivatives, dangerous if hand-written notes ever get mixed
into the vault root. Keep hand-written content in `vault/logs/` (a subdirectory
graphify does not manage).
