// レスポンスの本文を、元のレスポンスを消費せずに読む(etag と compress が使う)
// Response を見ても、本文がメモリにあるのかストリームなのかは分からない(c.text() の本文もストリームに見える)
// なので、短い時間だけ読んでみる。読み切れなければストリームとして扱う
// 判定を外しても、ETag が付かない、圧縮しない、というだけで、応答は壊れない

// メモリにある本文は、どのランタイムでも、この時間のうちに読み切れる(Bun / Deno / Node で確かめた値)
const WAIT_MS = 5;

// 戻り値: 全部読めたらその中身 / limit を超えたら "large" / 読めなければ(本文がない、遅い、エラー)null
export async function peekBody(res: Response, limit: number): Promise<Uint8Array | "large" | null> {
    if (res.body === null) return null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<null>((resolve) => {
        timer = setTimeout(resolve, WAIT_MS, null);
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        reader = res.clone().body!.getReader();
        for (;;) {
            const step = await Promise.race([reader.read(), expired]);
            if (step === null) return null;
            if (step.done) break;
            // 利用者のストリームは、Uint8Array 以外を流していることがある
            if (!(step.value instanceof Uint8Array)) return null;
            size += step.value.byteLength;
            if (size > limit) return "large";
            chunks.push(step.value);
        }
    } catch {
        // 使用済みの本文や、途中でエラーになったストリーム。送るときに、今までどおりの扱いになる
        return null;
    } finally {
        clearTimeout(timer);
        reader?.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
