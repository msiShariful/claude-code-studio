# Checklist — add a web section

1. **nav.ts** — add a `Section` entry: `key`, plain-language `label`, `tech` (the underlying
   Claude term), a one-line `info` tooltip, and `scope` (`'global' | 'project' | 'both'`).
2. **Test first** — create `tests/<name>.test.tsx` (jsdom + RTL) describing what the view renders.
   Watch it fail.
3. **Data** — if the view needs new data, add a server route (`packages/server/src/routes/…`) and
   a core function (`packages/core/src/…`) with their own tests, then a typed method + DTO in
   `packages/web/src/api.ts`.
4. **View** — create `views/<Name>.tsx`. Render `<PageHeader title=… label=… info=… />` and use
   shared `components/ui` primitives. Fetch via the `Api` client.
5. **Shell** — map the key in `Shell.tsx#renderSection`.
6. **Styles** — reuse `styles.css` tokens and existing classes; add scoped classes only if needed.
7. **Verify** — `npm run typecheck && npm test && npm run build`. Open `/global/<key>` (or
   `/project/<id>/<key>`), reload, and use back/forward to confirm routing.
8. **Commit** — Conventional Commit `feat(web): …`, plain author, no AI attribution.
