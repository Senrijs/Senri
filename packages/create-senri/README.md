# create-senri

Create a new [Senri](https://github.com/Senrijs/Senri) app.

```bash
npm create senri@latest my-app
bun create senri my-app
pnpm create senri my-app
deno run -A npm:create-senri my-app
```

If you leave out the folder name or `--template`, it asks for them (no questions when you pass both).
It creates a small app that runs right away: `createApp({ dev: devtools() })` and `serve(app)` (`export default app` on Cloudflare Workers).
When it is done, it prints the commands to start the app on that runtime.

## Templates

| `--template` | Runtime | Start with | URL |
| --- | --- | --- | --- |
| `bun` | Bun | `bun install` → `bun run dev` | http://localhost:3927 |
| `node` | Node.js 22.18 or later (runs TypeScript directly) | `npm install` → `npm run dev` | http://localhost:3927 |
| `deno` | Deno (uses `jsr:@senrijs/senri`) | `deno task dev` | http://localhost:3927 |
| `workers` | Cloudflare Workers (wrangler) | `npm install` → `npm run dev` | http://localhost:8787 |

## Options

```bash
npm create senri@latest my-app -- --template workers   # no questions
```

- `-t, --template <name>`: `bun`, `node`, `deno` or `workers`
- `-h, --help`: show help

Without a terminal (in CI, for example), pass both the folder name and `--template`.
If the folder exists and is not empty, nothing is written.

## License

MIT
