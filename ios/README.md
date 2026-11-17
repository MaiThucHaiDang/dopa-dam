# DopaDam for iPhone (web page)

A static page that Safari opens from the iPhone Shortcuts app (automation "when app X opens → run shortcut
DopaDam Cổng"). It shows the warning, keeps all state in `localStorage`, and hands control back to the shortcuts
`DopaDam Vào` and `DopaDam Thoát` through `shortcuts://` links. No server, no account, no external requests.
The setup guide for the shortcuts is `HUONG-DAN.md`.

Rules are the extension's: this folder imports `extension/src/core/` and `extension/src/background/{logic,state}.ts`
and adds only the storage adapter, the router, the `shortcuts://` links and the screens.

## Commands

Nothing is installed here: esbuild, TypeScript, vitest and Playwright come from `extension/node_modules`.
Run from `ios/` (the `npm run` forms are only shortcuts for these):

    node build.mjs                                   # build to ios/dist (static, relative URLs, any sub-path)
    ../extension/node_modules/.bin/tsc -p tsconfig.json --noEmit
    ../extension/node_modules/.bin/vitest run --config vitest.config.mjs
    PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 node test/e2e.mjs   # needs a fresh build; ~5 minutes

The browser test serves `dist/` under a sub-path, uses a 390x844 touch viewport with a mobile Safari user agent and
writes screenshots to `.toolchain/scratch/ios/`. Set `DOPADAM_E2E_CHANNEL` to use another browser channel.

Publish by copying `dist/` to any static host (for example GitHub Pages); the page needs HTTPS (service worker,
`crypto.randomUUID`, clipboard).

`icons/` are `shared/brand/icon-1024.png` flattened onto the design-token background and resized (Pillow).
