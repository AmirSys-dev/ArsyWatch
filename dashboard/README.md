# dashboard/ — Fasa 3

The public read-only dashboard. Next.js, static export, served by nginx.

## Read these first

| File | What it decides |
|---|---|
| [`TECHSTACK.md`](TECHSTACK.md) | Versions, static-export config, nginx setup, memory budget |
| [`COMPONENT-DECISIONS.md`](COMPONENT-DECISIONS.md) | Which library components to use, and which were rejected and why |
| [`explorations/README.md`](explorations/README.md) | Three layout directions, compared |
| [`../DESIGN.md`](../DESIGN.md) | The design system (warm paper, one orange accent, mono numerals) |
| [`../docs/api.md`](../docs/api.md) | The API contract |

## The stack

- **Next.js 16.4.0** — App Router
- **React 19.3.0**
- **Tailwind CSS 4.3.3** — CSS-first `@theme`, tokens from `../design-tokens.json`
- **shadcn/ui** — the component foundation
- **Output: `output: 'export'`** → a static `out/` folder. No Node process on the VPS.

Fonts: **system stack** (`ui-sans-serif` / `ui-monospace`). Inter is banned. If a
branded face is wanted later, Geist is the intended pick — but the explorations
shipped without it and look right, so this is optional.

## The two things that will bite you

**1. API calls must be relative.** There is no server behind a static export.
Use `/api/v1/aps`, never an absolute URL. In dev, proxy to Express:

```js
// next.config.mjs — dev only; ignored by the static export
const nextConfig = {
  output: 'export',
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:8787/api/:path*' }];
  },
};
```

**2. SSE needs nginx buffering off.** `proxy_buffering off;` on `/api/v1/events`,
or the live stream stalls and the page looks frozen while data is arriving. Full
config in [`TECHSTACK.md`](TECHSTACK.md).

## Scaffold

```bash
cd dashboard
npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*"
npx shadcn@latest init
npx shadcn@latest add data-table chart empty skeleton tooltip badge kbd dialog drawer sonner command separator scroll-area
```

Then **verify `npm run build` actually emits `out/`** before writing any UI.
Turbopack is the default in Next 16 and this must be confirmed, not assumed.

## Layout

The winning direction from `explorations/` gets rebuilt on shadcn primitives —
the explorations are hand-rolled HTML and exist to choose a *layout*, not to ship.
