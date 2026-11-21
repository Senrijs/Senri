// @ts-check
// --target docker: Dockerfile と .dockerignore を作る
// - 多段ビルド。最後のイメージは distroless(シェルもパッケージマネージャーもない)で、root では動かさない
// - Bun はエントリーを 1 つのファイルにまとめる(node_modules をイメージに入れない。起動のときにモジュールを探さない)
// - Node.js は本番の依存だけを入れて、package.json の start と同じく node <entry> で動かす(型は Node が取り除く)
// - Deno は依存を先にキャッシュしておき、deno.json の tasks.start と同じフラグで動かす
// 前提にしたことは、すべて Dockerfile の先頭のコメントに書く
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.js";
import { detectDenoVersion, detectLock, parseDenoTask } from "./project.js";

/** @typedef {import("./project.js").Project} Project */
/** @typedef {import("./write.js").GeneratedFile} GeneratedFile */
/** @typedef {import("./project.js").Runtime} Runtime */

// distroless の nonroot ユーザー。Kubernetes の runAsNonRoot が確かめられるように、数字で書く
export const NONROOT = 65532;

// Deno の tasks.start がないときのフラグ(create-senri の Deno のテンプレートと同じ)
const DENO_DEFAULT_FLAGS = ["--allow-net", "--allow-env=PORT,NODE_ENV"];

/**
 * @typedef {object} DockerOptions
 * @property {Runtime} runtime
 * @property {string} entry
 * @property {number} port
 * @property {string} header 先頭に付ける「senri build が作った」の行
 */

/**
 * @param {string[]} lines
 */
function comment(lines) {
    return lines.map((line) => (line === "" ? "#" : `# ${line}`)).join("\n");
}

/**
 * @param {Project} project
 * @param {DockerOptions} options
 * @returns {{ files: GeneratedFile[]; notes: string[] }}
 */
export function docker(project, options) {
    const { runtime, entry, port } = options;
    /** @type {string[]} */
    const notes = [];
    /** @type {string[]} */
    const assumptions = [];
    /** @type {string[]} */
    let body;

    if (runtime === "bun") {
        const { lock, file } = detectLock(project);
        const frozen = lock === "bun";
        const copy = ["package.json", ...(frozen && file ? [file] : [])];
        assumptions.push(
            `Runtime: Bun. ${entry} is bundled into one file with \`bun build --target bun --minify\`.`,
            "Only that file is copied into the final image (no node_modules, no other files).",
            "If the app reads files at run time (serveStatic(), templates, ...), add COPY lines for them.",
            "If a dependency cannot be bundled (native addons), bundling fails here; install it in the final image instead.",
            frozen
                ? `Dependencies: \`bun install --frozen-lockfile\` with ${file}.`
                : "Dependencies: `bun install` WITHOUT a lockfile (no bun.lock found), so versions may differ between builds.",
            "Base images: oven/bun:1 and oven/bun:1-distroless (Bun 1.x). Pin an exact version for reproducible builds.",
        );
        body = [
            "FROM oven/bun:1 AS build",
            "WORKDIR /app",
            `COPY ${copy.join(" ")} ./`,
            `RUN bun install${frozen ? " --frozen-lockfile" : ""}`,
            "COPY . .",
            `RUN bun build ${entry} --target bun --minify --outfile /out/server.js`,
            "",
            "FROM oven/bun:1-distroless",
            "WORKDIR /app",
            "COPY --from=build /out/server.js ./server.js",
            `USER ${NONROOT}:${NONROOT}`,
            "ENV NODE_ENV=production",
            `ENV PORT=${port}`,
            `EXPOSE ${port}`,
            "# The image's entrypoint is bun.",
            'CMD ["server.js"]',
        ];
    } else if (runtime === "node") {
        const { lock, file } = detectLock(project);
        /** @type {string[]} */
        let install;
        if (lock === "npm") {
            install = ["FROM node:24-slim AS deps", "WORKDIR /app", `COPY package.json ${file} ./`, "RUN npm ci --omit=dev"];
            assumptions.push(`Dependencies: \`npm ci --omit=dev\` with ${file}.`);
        } else if (lock === "pnpm") {
            install = [
                "FROM node:24-slim AS deps",
                "WORKDIR /app",
                `COPY package.json ${file} ./`,
                "RUN corepack enable && pnpm install --prod --frozen-lockfile",
            ];
            assumptions.push(`Dependencies: \`pnpm install --prod --frozen-lockfile\` (pnpm from Corepack) with ${file}.`);
        } else if (lock === "bun") {
            install = [
                "FROM oven/bun:1 AS deps",
                "WORKDIR /app",
                `COPY package.json ${file} ./`,
                "RUN bun install --production --frozen-lockfile",
            ];
            assumptions.push(`Dependencies: \`bun install --production --frozen-lockfile\` with ${file} (run on Node.js).`);
        } else if (lock === "yarn") {
            throw new UsageError(
                "yarn.lock is not supported by senri build yet. Write the install step yourself, or use npm, pnpm or Bun.",
            );
        } else {
            install = ["FROM node:24-slim AS deps", "WORKDIR /app", "COPY package.json ./", "RUN npm install --omit=dev"];
            assumptions.push(
                "Dependencies: `npm install --omit=dev` WITHOUT a lockfile (none found), so versions may differ between builds.",
            );
        }
        assumptions.push(
            `Runtime: Node.js 24. Runs \`node ${entry}\` like a start script (Node.js strips TypeScript types itself;`,
            "  TypeScript-only syntax such as enums is not supported by that).",
            "The whole build context is copied (see .dockerignore), then node_modules with production dependencies only.",
            "Base images: node:24-slim and gcr.io/distroless/nodejs24-debian12:nonroot.",
        );
        body = [
            ...install,
            "",
            "FROM gcr.io/distroless/nodejs24-debian12:nonroot",
            "WORKDIR /app",
            "COPY . .",
            "COPY --from=deps /app/node_modules ./node_modules",
            `USER ${NONROOT}:${NONROOT}`,
            "ENV NODE_ENV=production",
            `ENV PORT=${port}`,
            `EXPOSE ${port}`,
            "# The image's entrypoint is node.",
            `CMD [${JSON.stringify(entry)}]`,
        ];
    } else {
        const detected = detectDenoVersion();
        const version = detected?.version ?? "latest";
        if (!detected) notes.push("Could not find deno on this machine, so the Dockerfile uses denoland/deno:latest. Pin a version.");
        const task = parseDenoTask(project.deno?.tasks?.start);
        const flags = task && task.file === entry ? task.flags : DENO_DEFAULT_FLAGS;
        const lockfile = existsSync(join(project.dir, "deno.lock")) ? " --frozen" : "";
        assumptions.push(
            `Runtime: Deno ${version} (${detected ? detected.reason : "not found, so latest"}). Deno images have no major-only tag.`,
            task && task.file === entry
                ? `Permissions: ${flags.join(" ") || "(none)"} from tasks.start in ${project.denoConfig}.`
                : `Permissions: ${flags.join(" ")} (no matching tasks.start, so the same as the create-senri template).`,
            "Dependencies are cached in the build stage (`deno install --entrypoint`), so the container does not download at start.",
            lockfile
                ? "Dependencies: --frozen with deno.lock (the build fails if it is out of date)."
                : "Dependencies: no deno.lock found, so versions may differ between builds.",
            `Base images: denoland/deno:${version} and denoland/deno:distroless-${version}.`,
        );
        body = [
            `FROM denoland/deno:${version} AS build`,
            "WORKDIR /app",
            "COPY . .",
            `RUN deno install${lockfile} --entrypoint ${entry}`,
            "",
            `FROM denoland/deno:distroless-${version}`,
            "WORKDIR /app",
            "COPY --from=build /deno-dir /deno-dir",
            "COPY --from=build /app /app",
            `USER ${NONROOT}:${NONROOT}`,
            "ENV NODE_ENV=production",
            `ENV PORT=${port}`,
            `EXPOSE ${port}`,
            "# The image's entrypoint is deno (behind tini).",
            `CMD ${JSON.stringify(["run", ...flags, entry])}`,
        ];
    }

    const dockerfile = [
        options.header,
        comment([
            "",
            "Assumptions (edit this file if any of them is wrong; senri build will not overwrite it):",
            ...assumptions.map((line) => (line.startsWith("  ") ? line : `- ${line}`)),
            `- Port: ${port} (PORT is set to it; serve() from @senrijs/senri/serve reads PORT).`,
            "- NODE_ENV=production, so devtools() does nothing. Still, remove it from production builds.",
            `- Runs as the distroless nonroot user (uid ${NONROOT}).`,
            "- No HEALTHCHECK: distroless images have no shell or curl. Use the orchestrator's checks",
            "  (senri build --target k8s writes liveness and readiness probes for /healthz and /readyz).",
            "- Stopping: serve() handles SIGTERM itself (no init process needed) and waits up to shutdownTimeout",
            "  (default 10 s) for in-flight requests. `docker stop` waits only 10 s by default, so use",
            "  `docker stop -t 20` (or a longer stop timeout in your platform) to let it finish.",
        ]),
        "",
        ...body,
        "",
    ].join("\n");

    const dockerignore = [
        options.header,
        "# Files left out of the Docker build context. Add anything else that must not end up in the image.",
        "node_modules",
        ".git",
        ".env",
        ".env.*",
        "dist",
        ".wrangler",
        "k8s",
        "Dockerfile",
        ".dockerignore",
        "",
    ].join("\n");

    return {
        files: [
            { path: "Dockerfile", content: dockerfile },
            { path: ".dockerignore", content: dockerignore, keepIfExists: true },
        ],
        notes,
    };
}
