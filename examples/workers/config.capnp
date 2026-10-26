# workerd で examples/workers を動かす設定(scripts/smoke.ts が使う)
# worker.js は bun build でまとめたもの: bun build examples/workers/index.ts --outfile examples/workers/dist/worker.js
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "main", worker = .worker)],
  sockets = [(name = "http", address = "*:3929", http = (), service = "main")],
);

const worker :Workerd.Worker = (
  modules = [(name = "worker.js", esModule = embed "dist/worker.js")],
  compatibilityDate = "2026-10-01",
  bindings = [(name = "GREETING", text = "Workers から、こんにちは")],
);
