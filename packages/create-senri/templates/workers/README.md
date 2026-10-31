# {{name}}

A [Senri](https://github.com/Senrijs/Senri) app for Cloudflare Workers.

```bash
npm install
npm run dev       # http://localhost:8787 (wrangler dev)
npm run deploy    # wrangler deploy
```

Settings such as bindings go in `wrangler.jsonc`. Type them with `createApp<{ Bindings: Env }>()` to use `c.env`.
