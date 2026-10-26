// 開発モードで、層ごとの時間を Server-Timing ヘッダーに載せる(ブラウザの開発者ツールの「タイミング」に出る)
// 開発者ツールは入れ子の図にはしないが、外側の層ほど長い(内側を含む)ので、上から順に玉ねぎの外側→内側になる
import type { Timing } from "../compose.ts";

// desc は quoted-string なので、" と \ をエスケープする
function quote(text: string): string {
    return `"${text.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;
}

const ms = (n: number) => Math.max(0, n).toFixed(2);

// timings: 外側から順(最後がいちばん内側)。inner: いちばん内側の層の名前("GET /users/:id" や "notFound")
// 名前(metric-name)は、アプリが自分で付ける名前とぶつからないよう senri- で始める
export function serverTimingHeader(timings: readonly Timing[], inner: { name: string; desc: string }, total: number): string {
    const entries: string[] = [];
    const last = timings.length - 1;
    timings.forEach((t, i) => {
        // 例外などで途中までしか通っていないと、穴が空くことがある
        if (!t) return;
        if (i === last && t.name === inner.name) {
            entries.push(`senri-${inner.name};desc=${quote(inner.desc)};dur=${ms(t.total)}`);
        } else {
            entries.push(`senri-${i + 1};desc=${quote(`${i + 1}. ${t.name} (self ${ms(t.self)}ms)`)};dur=${ms(t.total)}`);
        }
    });
    entries.push(`senri-total;desc="total";dur=${ms(total)}`);
    return entries.join(", ");
}

// レスポンスに足す。アプリが付けた Server-Timing は残して、後ろにつなぐ
export function withServerTiming(res: Response, value: string): Response {
    // 101(WebSocket のアップグレード)などは作り直すと壊れるので触らない
    if (res.status < 200) return res;
    const current = res.headers.get("server-timing");
    const next = current ? `${current}, ${value}` : value;
    try {
        res.headers.set("server-timing", next);
        return res;
    } catch {
        // fetch() や Response.redirect() の Response はヘッダーを変更できないので、作り直す
        const headers = new Headers(res.headers);
        headers.set("server-timing", next);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
}
