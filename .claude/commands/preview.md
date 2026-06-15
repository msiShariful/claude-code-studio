---
description: Build and run Studio locally, then share the tokenized URL
---

Build and launch the app for manual testing.

1. Start `npm run preview` as a background process (it builds, removes any stale
   `packages/server/web-dist`, then serves on a random port).
2. Read the printed `http://127.0.0.1:<port>/#token=…` line and give it to me to open.
3. Confirm it's serving the freshly built bundle (the asset hash in the served `index.html`
   matches `packages/web/dist`).

Leave it running so I can click around; stop the background server when I say I'm done.
