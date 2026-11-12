// リクエストの本文の既定の上限(createApp({ maxBodySize })。既定は 1 MiB)
// - 本文を読んだときだけ効く(読まないルートは何も変わらない)。リクエストごとに「上限の箱」を持つ
// - 読みながら数えて、超えたら HttpError 413 でストリームをエラーにする。残りの本文は裏で読み捨てる(メモリには貯めない)
//   - 読まずに止めると、クライアントは送っている途中で失敗するか、送り切れずに待ち続ける
//   - 元のストリームを cancel しないのは、Node の Readable.toWeb() のストリームが、cancel のあとに届いたデータで例外を投げるため
//   - 本文を読まないルートでも、ランタイム(Node など)は応答のあとに残りを読み捨てるので、それより悪くはならない
// - Content-Length が上限より大きければ、中身を渡さずに 413 にする(残りは読み捨てる)
// - ルートの bodyLimit()(と、それを使う uploadLimit())と multipart() は、自分の上限を持つので、既定を外す(releaseBodyCap)
//   上限は読むたびに見るので、ストリームを作ったあとで外しても効く
// - 超えたかどうか(exceeded)を覚えておき、ハンドラーがエラーを握りつぶしても、呼んだ側(app.fetch・アダプター)が 413 にする
// 本体のサイズを抑えるため、短く書いている(本体の最小アプリは gzip 後 7 KB 以下が目標)
// 公開しない部品(package.json / jsr.json の exports に載せない)
import { HttpError } from "./errors.ts";

/** The default body limit of one request: `max` bytes (`Infinity` once a route's own limit replaces it). */
export type BodyCap = { max: number; exceeded: boolean };

const caps = new WeakMap<object, BodyCap>();

// リクエスト(の Context)に上限の箱を結び付ける
export function attachBodyCap(c: object, cap: BodyCap): BodyCap {
    caps.set(c, cap);
    return cap;
}

// 既定の上限を外す(ルートの bodyLimit() / multipart() が、自分の上限で置き換えるとき)
export function releaseBodyCap(c: object): void {
    const cap = caps.get(c);
    if (cap) cap.max = Infinity;
}

// 上限を超えたときの応答(bodyLimit() の既定と同じ。文字列の本文なので、Content-Type はランタイムが text/plain にする)
export const tooLargeResponse = (): Response => new Response("413 Content Too Large", { status: 413 });

// Content-Length の値。なければ null。数でない値(ふつうはランタイムの HTTP パーサーがはじく)は NaN で、
// 比べると false になるので、長さが分からないものとして扱われる
export const declaredLength = (value: string | null | undefined): number | null => (value == null ? null : +value);

// 本文を数えるストリームにする。declared は Content-Length(なければ null)
export function capBody(body: ReadableStream<Uint8Array>, cap: BodyCap, declared: number | null): ReadableStream<Uint8Array> {
    let size = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            reader ??= body.getReader();
            // 読み始めたときに、宣言された長さで決められるなら、中身を渡さずに断る
            const { done, value } = declared! > cap.max ? { done: false, value: undefined } : await reader.read();
            if (done) return controller.close();
            if (value && (size += value.byteLength) <= cap.max) return controller.enqueue(value);
            cap.exceeded = true;
            controller.error(new HttpError(413, "413 Content Too Large"));
            // 残りを裏で読み捨てる
            const r = reader;
            void (async () => {
                try {
                    while (!(await r.read()).done);
                } catch {}
            })();
        },
        cancel(reason) {
            return (reader ?? body).cancel(reason);
        },
    });
}

// createApp({ maxBodySize }) を確かめる。省略すると 1 MiB。Infinity で上限なし
export function checkMaxBodySize(max: number | undefined): number {
    if (max === undefined) return 1048576;
    if (typeof max !== "number" || !(max >= 0)) throw new RangeError(`maxBodySize must be 0 or more: ${max}`);
    return max;
}
