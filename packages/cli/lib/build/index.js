// @ts-check
// senri build --target workers | docker | k8s
// プロジェクトから読んだ事実と、前提にした値を、画面と書き出すファイルの両方に正直に出す
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { UsageError } from "../errors.js";
import { version } from "../main.js";
import { docker } from "./docker.js";
import { gracePeriod, k8s } from "./k8s.js";
import { detectEntry, detectRuntime, readProject, RUNTIMES } from "./project.js";
import { localWrangler, workers, WORKERS_OUT, WRANGLER_ARGS } from "./workers.js";
import { plan, write } from "./write.js";

/** @typedef {import("./write.js").GeneratedFile} GeneratedFile */

export const TARGETS = /** @type {const} */ (["workers", "docker", "k8s"]);
/** @typedef {(typeof TARGETS)[number]} Target */

// serve() の既定に合わせる(@senrijs/senri/serve の DEFAULT_PORT と shutdownTimeout、health() のパス)
const DEFAULTS = {
    port: 3927,
    shutdownTimeout: 10000,
    preStopSleep: 5,
    healthPath: "/healthz",
    readyPath: "/readyz",
};

const HELP = `Write deployment files for a Senri app. Run it in the project folder.

Usage:
  senri build --target <target> [options]

Targets (repeat --target for more than one):
  workers  wrangler.jsonc (if missing) and a bundle in ${WORKERS_OUT}/ made by the project's wrangler
  docker   Dockerfile and .dockerignore (multi-stage, distroless, non-root)
  k8s      k8s/deployment.yaml and k8s/service.yaml (probes for /healthz and /readyz, graceful shutdown)

Options:
  --runtime <name>           ${RUNTIMES.join(" | ")} (docker). Default: guessed from deno.json, bun.lock or package.json
  --entry <file>             The file that starts the app. Default: from the start script, or src/index.ts
  --port <n>                 The port the app listens on (docker, k8s). Default: ${DEFAULTS.port}
  --image <name>             The image in the Deployment (k8s). Default: <package name>:<version>
  --shutdown-timeout <ms>    serve()'s shutdownTimeout (k8s). Default: ${DEFAULTS.shutdownTimeout}
  --pre-stop-sleep <s>       Seconds to sleep in preStop (k8s). 0 leaves preStop out (for Kubernetes < 1.30). Default: ${DEFAULTS.preStopSleep}
  --health-path <path>       The liveness path of health() (k8s). Default: ${DEFAULTS.healthPath}
  --ready-path <path>        The readiness path of health() (k8s). Default: ${DEFAULTS.readyPath}
  --dry-run                  Print the files instead of writing them
  --force                    Overwrite files that already exist
  -h, --help                 Show this help

Existing files are never overwritten without --force. If one would be, nothing is written.
`;

/**
 * @param {string | undefined} raw
 * @param {string} flag
 * @param {number} fallback
 * @param {{ min: number; max: number }} range
 */
function intOption(raw, flag, fallback, range) {
    if (raw === undefined) return fallback;
    const n = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(n) || n < range.min || n > range.max) {
        throw new UsageError(`${flag} must be a whole number from ${range.min} to ${range.max}: ${raw}`);
    }
    return n;
}

/**
 * @param {string | undefined} raw
 * @param {string} flag
 * @param {string} fallback
 */
function pathOption(raw, flag, fallback) {
    if (raw === undefined) return fallback;
    if (!/^\/[\w\-./~]*$/.test(raw)) throw new UsageError(`${flag} must be a path starting with /: ${raw}`);
    return raw;
}

// health() を使っているかを、エントリーのあるフォルダのソースから探す(文字列で探すだけなので、目安)
/**
 * @param {string} dir
 * @param {number} depth
 * @returns {boolean}
 */
function usesHealth(dir, depth = 0) {
    if (depth > 6) return false;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return false;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (["node_modules", "dist", ".git", ".wrangler", "k8s"].includes(entry.name)) continue;
            if (usesHealth(join(dir, entry.name), depth + 1)) return true;
        } else if (/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name)) {
            if (/\bhealth\s*\(/.test(readFileSync(join(dir, entry.name), "utf8"))) return true;
        }
    }
    return false;
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string; log?: (line: string) => void }} [io]
 */
export async function run(args, io = {}) {
    const cwd = io.cwd ?? process.cwd();
    const log = io.log ?? ((line) => console.log(line));
    let parsed;
    try {
        parsed = parseArgs({
            args,
            options: {
                target: { type: "string", short: "t", multiple: true },
                runtime: { type: "string" },
                entry: { type: "string" },
                port: { type: "string" },
                image: { type: "string" },
                "shutdown-timeout": { type: "string" },
                "pre-stop-sleep": { type: "string" },
                "health-path": { type: "string" },
                "ready-path": { type: "string" },
                "dry-run": { type: "boolean" },
                force: { type: "boolean" },
                help: { type: "boolean", short: "h" },
            },
        });
    } catch (err) {
        throw new UsageError(`${/** @type {Error} */ (err).message}\n\n${HELP}`);
    }
    const v = parsed.values;
    if (v.help) {
        log(HELP);
        return;
    }
    const targets = [...new Set(v.target ?? [])];
    if (targets.length === 0) throw new UsageError(`Pass --target (${TARGETS.join(" | ")}).\n\n${HELP}`);
    for (const target of targets) {
        if (!(/** @type {readonly string[]} */ (TARGETS).includes(target))) {
            throw new UsageError(`Unknown target: ${JSON.stringify(target)}. Use one of: ${TARGETS.join(", ")}`);
        }
    }
    const has = (/** @type {Target} */ target) => targets.includes(target);
    if (has("workers") && targets.length > 1) {
        // Workers はコンテナではないので、docker / k8s と同じエントリー・ポートの前提を共有できない
        throw new UsageError("--target workers cannot be combined with docker or k8s. Run them separately.");
    }

    // 使わないフラグを黙って無視しない(効いていると思い込ませないように)
    /** @type {[string, Target[]][]} */
    const scoped = [
        ["runtime", ["docker"]],
        ["port", ["docker", "k8s"]],
        ["image", ["k8s"]],
        ["shutdown-timeout", ["k8s"]],
        ["pre-stop-sleep", ["k8s"]],
        ["health-path", ["k8s"]],
        ["ready-path", ["k8s"]],
    ];
    for (const [flag, usedBy] of scoped) {
        if (v[/** @type {keyof typeof v} */ (flag)] !== undefined && !usedBy.some(has)) {
            throw new UsageError(`--${flag} is used only with --target ${usedBy.join(" or ")}.`);
        }
    }

    const port = intOption(v.port, "--port", DEFAULTS.port, { min: 1, max: 65535 });
    const shutdownTimeout = intOption(v["shutdown-timeout"], "--shutdown-timeout", DEFAULTS.shutdownTimeout, {
        min: 0,
        max: 3_600_000,
    });
    const preStopSleep = intOption(v["pre-stop-sleep"], "--pre-stop-sleep", DEFAULTS.preStopSleep, { min: 0, max: 3600 });
    const healthPath = pathOption(v["health-path"], "--health-path", DEFAULTS.healthPath);
    const readyPath = pathOption(v["ready-path"], "--ready-path", DEFAULTS.readyPath);

    const project = readProject(cwd);
    const command = `senri build ${targets.map((t) => `--target ${t}`).join(" ")}`;
    const header = `# Generated by \`${command}\` (@senrijs/cli ${version()}).`;

    /** @type {GeneratedFile[]} */
    const files = [];
    /** @type {string[]} */
    const notes = [];
    /** @type {string[]} */
    const facts = [];
    let entry;
    let workersPlan;

    if (has("workers")) {
        workersPlan = workers(project, { entry: v.entry, header });
        files.push(...workersPlan.files);
        notes.push(...workersPlan.notes);
        facts.push(...workersPlan.facts);
        entry = workersPlan.entry;
    } else {
        if (has("docker")) {
            const { runtime, reason } = detectRuntime(project, v.runtime);
            const detected = detectEntry(project, runtime, v.entry);
            entry = detected.entry;
            facts.push(`Runtime: ${runtime} (${reason})`, `Entry: ${entry} (${detected.reason})`, `Port: ${port}`);
            const out = docker(project, { runtime, entry, port, header });
            files.push(...out.files);
            notes.push(...out.notes);
        } else {
            // k8s だけのときは、health() を探すためにエントリーを使う(見つからなくても止めない)
            try {
                entry = detectEntry(project, project.denoConfig ? "deno" : "node", v.entry).entry;
            } catch {
                entry = undefined;
            }
            facts.push(`Port: ${port}`);
        }
        if (has("k8s")) {
            const image = v.image ?? `${project.name}:${project.version ?? "latest"}`;
            const options = { port, image, shutdownTimeout, preStopSleep, healthPath, readyPath, header };
            facts.push(
                `Image: ${image}${v.image ? "" : " (from package name and version; pass --image for your registry)"}`,
                `Probes: liveness ${healthPath}, readiness ${readyPath}`,
                `terminationGracePeriodSeconds: ${gracePeriod(options)} (preStop ${preStopSleep} s + shutdownTimeout ${shutdownTimeout} ms + margin)`,
            );
            if (preStopSleep > 0) facts.push("preStop uses the native sleep action: Kubernetes 1.30 or later");
            const out = k8s(project, options);
            files.push(...out.files);
            notes.push(...out.notes);
            const searchDir = entry ? dirname(join(cwd, entry)) : cwd;
            if (!usesHealth(searchDir)) {
                notes.push(
                    `Did not find health() in ${entry ? dirname(entry) : "."}/. Add app.use(health()) from @senrijs/senri, ` +
                        `or the probes on ${healthPath} and ${readyPath} fail and the Pod never becomes ready.`,
                );
            }
        }
    }
    if (entry) {
        try {
            if (/["']@senrijs\/senri\/dev["']/.test(readFileSync(join(cwd, entry), "utf8"))) {
                notes.push(
                    `${entry} imports devtools() from @senrijs/senri/dev. It does nothing with NODE_ENV=production, ` +
                        "but its code stays in the bundle. Remove it from production builds.",
                );
            }
        } catch {
            // 読めないエントリーは、それぞれのターゲットがすでに知らせている
        }
    }

    log(`senri build (${targets.join(", ")}) in ${cwd}`);
    for (const fact of facts) log(`  ${fact}`);
    log("");

    const p = plan(cwd, files, v.force ?? false);
    if (v["dry-run"]) {
        for (const [kind, list] of /** @type {const} */ ([
            ["create", p.create],
            ["overwrite", p.overwrite],
            ["keep", p.keep],
        ])) {
            for (const file of list) {
                log(`--- ${file.path} (${kind === "keep" ? "already exists, would be kept" : `would ${kind}`}) ---`);
                if (kind !== "keep") log(file.content);
            }
        }
        if (workersPlan) log(`Would run: wrangler ${WRANGLER_ARGS.join(" ")}`);
        log("Dry run: nothing was written.");
    } else {
        write(cwd, p);
        for (const file of p.create) log(`  created      ${file.path}`);
        for (const file of p.overwrite) log(`  overwrote    ${file.path} (--force)`);
        for (const file of p.keep) log(`  kept         ${file.path} (already exists; check that it fits the new files)`);
        if (workersPlan) bundleWorkers(cwd, log);
    }

    for (const note of notes) log(`\nnote: ${note}`);
    log(`\nNext:\n${nextSteps(targets, project.name, workersPlan ? workersPlan.config : undefined)}`);
}

/**
 * プロジェクトの wrangler で、まとめられるかを確かめ、dist/workers にバンドルを書く(出しはしない)
 * @param {string} cwd
 * @param {(line: string) => void} log
 */
function bundleWorkers(cwd, log) {
    const wrangler = localWrangler(cwd);
    const isDeno = "Deno" in globalThis;
    if (!wrangler || isDeno) {
        log(
            `\n  Did not bundle: ${isDeno ? "running on Deno" : "wrangler is not installed in this project (npm i -D wrangler)"}.` +
                `\n  Run it yourself: npx wrangler ${WRANGLER_ARGS.join(" ")}`,
        );
        return;
    }
    log(`\n  Bundling with the project's wrangler: wrangler ${WRANGLER_ARGS.join(" ")}`);
    log(`  (${WORKERS_OUT}/ is build output; wrangler replaces the files in it.)\n`);
    const result = spawnSync(process.execPath, [wrangler, ...WRANGLER_ARGS], { cwd, stdio: "inherit" });
    if (result.status !== 0) {
        throw new UsageError(`wrangler failed (exit code ${result.status ?? result.signal}). The files above were still written.`);
    }
}

/**
 * @param {string[]} targets
 * @param {string} name
 * @param {string | undefined} wranglerConfig
 */
function nextSteps(targets, name, wranglerConfig) {
    const steps = [];
    if (targets.includes("workers")) steps.push(`npx wrangler deploy   # deploys with ${wranglerConfig}`);
    if (targets.includes("docker")) {
        steps.push(`docker build -t ${name} .`, `docker run --rm -p 3927:3927 ${name}   # change the ports if you passed --port`);
    }
    if (targets.includes("k8s")) steps.push("kubectl apply -f k8s/   # after pushing the image named in k8s/deployment.yaml");
    return steps.map((s) => `  ${s}`).join("\n");
}
