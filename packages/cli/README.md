# @senrijs/cli

The `senri` command for [Senri](https://github.com/Senrijs/Senri) apps.

```bash
npm i -D @senrijs/cli        # or: bun add -d @senrijs/cli
npx senri build --target docker
```

Without installing it: `npx @senrijs/cli build ...`, `bunx @senrijs/cli build ...` or `deno run -A npm:@senrijs/cli build ...`.

The CLI only writes files you could write yourself. Everything it assumes (port, health check paths, timeouts,
resource values) is written as comments in the files it creates, and it never overwrites a file without `--force`.

## senri build

Run it in the project folder.

| `--target` | Writes |
| --- | --- |
| `workers` | `wrangler.jsonc` (only if there is no wrangler config), then bundles with the project's wrangler into `dist/workers/` to check that it builds. Deploy with `wrangler deploy`. |
| `docker` | `Dockerfile` (multi-stage, distroless, non-root) and `.dockerignore` (kept if it already exists) |
| `k8s` | `k8s/deployment.yaml` and `k8s/service.yaml`: liveness on `/healthz`, readiness on `/readyz`, and `terminationGracePeriodSeconds` that fits `serve()`'s graceful shutdown |

```bash
senri build --target docker --target k8s --image registry.example.com/my-app:1.0.0
```

- The k8s files expect `app.use(health())` from `@senrijs/senri` and `serve()` from `@senrijs/senri/serve`
- `preStop` uses the native `sleep` action, which needs **Kubernetes 1.30 or later**. On older clusters, pass `--pre-stop-sleep 0`
- `--dry-run` prints the files without writing them

See `senri build --help` for all options, and the [documentation](https://senri.skyia.jp/en/docs/production/build).

## License

MIT
