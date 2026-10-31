# create-senri

Create a new [Senri](https://github.com/Senrijs/Senri) app.

```bash
npm create senri@latest my-app
bun create senri my-app
pnpm create senri my-app
deno run -A npm:create-senri my-app
```

It asks for the folder name (unless you pass it) and the runtime, then creates a small app that runs right away:
`createApp({ dev: devtools() })` and `serve(app)` (`export default app` on Cloudflare Workers).

```bash
cd my-app
npm install
npm run dev      # → http://localhost:3927
```

## Templates

| `--template` | Runtime | Start with |
| --- | --- | --- |
| `bun` | Bun | `bun run dev` |
| `node` | Node.js 22.18 or later (runs TypeScript directly) | `npm run dev` |
| `deno` | Deno (uses `jsr:@senrijs/senri`) | `deno task dev` |
| `workers` | Cloudflare Workers (wrangler) | `npm run dev` → http://localhost:8787 |

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
