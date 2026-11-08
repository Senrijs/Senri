// ```npm のコードブロックから、Deno のタブのコマンドを作る(fumadocs-core の remarkNpm に渡す)
// - npm i / install: deno add。@senrijs/senri は JSR から(jsr:)、ほかは npm から(npm:)入れる
// - npm create x / npx x: deno run -A npm:create-x / npm:x
// - そのほか(npm run など)は Deno に同じものがないので、undefined を返して Deno のタブを出さない
// 複数行のときは、1行でも書けないものがあればタブを出さない
const JSR_PACKAGES = new Set(["@senrijs/senri"]);

function specifier(name: string): string {
    const bare = name.replace(/@[^/@]*$/, "");
    return JSR_PACKAGES.has(bare) ? `jsr:${name}` : `npm:${name}`;
}

function line(cmd: string): string | undefined {
    const words = cmd.trim().split(/\s+/);
    const [tool, sub, ...rest] = words;
    if (tool === "npm" && (sub === "i" || sub === "install")) {
        const dev = rest.some((w) => w === "-D" || w === "--save-dev");
        const names = rest.filter((w) => !w.startsWith("-"));
        if (names.length === 0) return "deno install";
        return `deno add ${dev ? "-D " : ""}${names.map(specifier).join(" ")}`;
    }
    if (tool === "npm" && sub === "create" && rest[0]) {
        const [name, ...args] = rest;
        const scoped = name!.startsWith("@");
        const pkg = scoped ? name!.replace(/^(@[^/]+)(?:\/(.*))?$/, (_, scope, n) => `${scope}/create${n ? `-${n}` : ""}`) : `create-${name}`;
        return ["deno run -A", `npm:${pkg}`, ...args.filter((a) => a !== "--")].join(" ");
    }
    if (tool === "npx" && sub) return ["deno run -A", `npm:${sub}`, ...rest].join(" ");
    return undefined;
}

export function denoCommand(cmd: string): string | undefined {
    const lines = cmd.split("\n").map(line);
    return lines.every((l) => l !== undefined) ? lines.join("\n") : undefined;
}
