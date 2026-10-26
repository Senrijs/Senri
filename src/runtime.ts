// ランタイムごとに違う処理(カレントディレクトリ、環境変数、ファイルの読み込み権限)。開発用ページと serve() で使う
//
// Deno は、許可されていない環境変数やファイルを読もうとすると、ターミナルで「許可しますか?」と聞いてきて
// その間リクエストが止まってしまう。なので先に permissions.querySync() で「許可済みか」だけを確かめ、
// 許可されていなければ読まずにあきらめる(聞き返しはしない)

// Deno の、ここで使う部分だけの型(src は Deno の型を入れていないので自分で書く)
type DenoLike = {
    permissions: { querySync(desc: { name: string; path?: string; variable?: string }): { state: string } };
    cwd(): string;
    env: { get(name: string): string | undefined };
};
type ProcessLike = {
    cwd(): string;
    env: Record<string, string | undefined>;
};

const g = globalThis as { Deno?: DenoLike; process?: ProcessLike; navigator?: { userAgent?: string } };

// Cloudflare Workers(workerd)で動いているか。Workers の navigator.userAgent は決まった値になる
export function isWorkers(): boolean {
    return g.navigator?.userAgent === "Cloudflare-Workers";
}

function denoAllows(desc: { name: string; path?: string; variable?: string }): boolean {
    try {
        return g.Deno!.permissions.querySync(desc).state === "granted";
    } catch {
        return false;
    }
}

// スラッシュ区切りのカレントディレクトリ。分からなければ null
export function cwd(): string | null {
    try {
        // Deno 2 には process もあるが、権限の確認をしたいので Deno を先に見る
        // 全体({ name: "read" })で聞くと、--allow-read=. のように範囲を絞ったときに "prompt" になってしまう。
        // カレントディレクトリが読めればよいので、"." で聞く
        if (g.Deno) return denoAllows({ name: "read", path: "." }) ? g.Deno.cwd().replaceAll("\\", "/") : null;
        if (g.process) return g.process.cwd().replaceAll("\\", "/");
    } catch {
        // 読めなければあきらめる
    }
    return null;
}

export function env(name: string): string | undefined {
    try {
        if (g.Deno) return denoAllows({ name: "env", variable: name }) ? g.Deno.env.get(name) : undefined;
        return g.process?.env[name];
    } catch {
        return undefined;
    }
}

export function canRead(path: string): boolean {
    if (g.Deno) return denoAllows({ name: "read", path });
    return true;
}
