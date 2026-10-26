// err.stack(文字列)を、ページで扱いやすい { fn, file, line, col } の配列にする
//
// 3ランタイムとも "    at 関数名 (場所)" か "    at 場所" という V8 風の書式だが、「場所」の書き方が違う
// - Bun:  C:\Users\me\app.ts:6:15            (Windows の生のパス)
// - Node: file:///C:/Users/SHO%20T/app.ts:6:11 (エンコードされた file:// URL)
// - Deno: file:///C:/Users/SHO T/app.ts:6:11   (エンコードされていない file:// URL も混ざる)
// そこで、場所を「末尾の :行:列」から逆に読み、パスはスラッシュ区切りの絶対パスにそろえる

// - user: 利用者のコード(開いて直す対象)
// - senri: Senri 本体(ページでは折りたたむ)
// - node_modules: ほかのライブラリ
// - runtime: node:internal / ext:core / native など、ランタイムの中
export type FrameKind = "user" | "senri" | "node_modules" | "runtime";

export type StackFrame = {
    fn: string;
    // スラッシュ区切りの絶対パス。ランタイム内部なら "node:internal/..." などそのまま
    file: string;
    // 1 始まり。分からなければ 0
    line: number;
    col: number;
    kind: FrameKind;
};

export type ParseOptions = {
    // Senri 本体のディレクトリ(スラッシュ区切り)。省略するとこのファイルの場所から決める
    senriDirs?: string[];
};

// このファイルは src/dev/stack.ts(ビルド後は dist/src/dev/stack.js)にある
// そこから2つ上がパッケージのルートで、その下の src / adapters / dist が Senri 本体
// Cloudflare Workers のように1つのファイルにまとめられていると import.meta.url がない(またはファイルの URL でない)。
// そのときは Senri の場所が分からないので、区別しない(どのフレームも利用者のコードとして扱う)
function defaultSenriDirs(): string[] {
    const here: unknown = import.meta.url;
    // data: URL のように、相対パスを解決できない URL のこともある
    if (typeof here !== "string" || !URL.canParse("../..", here)) return [];
    const root = toPath(new URL("../..", here).href).replace(/\/$/, "");
    // ビルド後は root が .../dist になっている
    const pkg = root.endsWith("/dist") ? root.slice(0, -"/dist".length) : root;
    return [`${pkg}/src`, `${pkg}/adapters`, `${pkg}/dist`];
}

// "file:///C:/a%20b/x.ts" や "C:\a b\x.ts" を "C:/a b/x.ts" にする
function toPath(location: string): string {
    if (location.startsWith("file://")) {
        // new URL は空白をエンコードし直すので、エンコードあり・なしのどちらでも同じ結果になる
        const pathname = decodeURIComponent(new URL(location).pathname);
        // Windows: "/C:/Users/..." の先頭の "/" を取る
        return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    }
    return location.replaceAll("\\", "/");
}

function isRuntime(location: string): boolean {
    return /^(node|ext|bun|deno):/.test(location) || location === "native" || !location.includes("/");
}

// Windows はドライブ文字やフォルダ名の大文字小文字を区別しないので、そろえて比べる
function sameOrInside(path: string, dir: string): boolean {
    const norm = (p: string) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
    const p = norm(path);
    const d = norm(dir).replace(/\/$/, "");
    return p === d || p.startsWith(`${d}/`);
}

function classify(file: string, senriDirs: string[]): FrameKind {
    if (isRuntime(file)) return "runtime";
    // node_modules/senri は Senri 本体として扱いたいので、node_modules より先に見る
    if (senriDirs.some((dir) => sameOrInside(file, dir))) return "senri";
    if (file.includes("/node_modules/")) return "node_modules";
    return "user";
}

// "Object.auth [as mw]" → "auth"、"async getUser" → "getUser"
function cleanName(fn: string): string {
    const name = fn
        .replace(/^async /, "")
        .replace(/ \[as [^\]]+\]$/, "")
        .replace(/^Object\./, "");
    return name === "" ? "<anonymous>" : name;
}

// "場所" を { file, line, col } に。末尾が :行:列 でなければ行も列も 0
function splitLocation(location: string): { file: string; line: number; col: number } {
    const m = /^(.*):(\d+):(\d+)$/.exec(location);
    if (!m) return { file: location, line: 0, col: 0 };
    return { file: toPath(m[1]!), line: Number(m[2]), col: Number(m[3]) };
}

function parseLine(line: string, senriDirs: string[]): StackFrame | null {
    const m = /^\s*at (.*)$/.exec(line);
    if (!m) return null;
    const rest = m[1]!;

    // "関数名 (場所)" の形。パスにも "(" が入りうる("Program Files (x86)")ので、
    // 最初の " (" で切り、末尾が ")" で閉じているものだけを採用する
    const open = rest.indexOf(" (");
    let fn = "<anonymous>";
    let location = rest;
    if (open !== -1 && rest.endsWith(")")) {
        fn = cleanName(rest.slice(0, open));
        location = rest.slice(open + 2, -1);
    }

    const { file, line: lineNo, col } = splitLocation(location);
    return { fn, file, line: lineNo, col, kind: classify(file, senriDirs) };
}

export function parseStack(stack: string, options: ParseOptions = {}): StackFrame[] {
    const senriDirs = (options.senriDirs ?? defaultSenriDirs()).map((d) => d.replaceAll("\\", "/"));
    const frames: StackFrame[] = [];
    for (const line of stack.split("\n")) {
        const frame = parseLine(line, senriDirs);
        if (frame) frames.push(frame);
    }
    return frames;
}
