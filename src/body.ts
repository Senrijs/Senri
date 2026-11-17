// リクエストのボディを、Content-Type に合わせて読む
import { HttpError } from "./errors.ts";

// フォームの値。同じ名前が複数あれば配列になる
/** A form field's value. */
export type FormValue = string | File;
/** A form body read by `c.body()`. Repeated field names become arrays. */
export type FormBody = Record<string, FormValue | FormValue[]>;

function mediaType(req: Request): string {
    return (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

// フィールド名は送る側が決められるので、プロトタイプのないオブジェクトに入れる
// (ふつうの {} だと "__proto__" でプロトタイプが差し替わり、"constructor" は継承した関数と混ざる)
function formToObject(form: FormData): FormBody {
    const out: FormBody = Object.create(null);
    for (const [name, value] of form) {
        const prev = out[name];
        if (prev === undefined) out[name] = value;
        else out[name] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    }
    return out;
}

// 文字列を JSON として読む(壊れていたら・空なら 400)。c.body() と c.bodyJson() が使う
export function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new HttpError(400, "400 Bad Request: Invalid JSON", { cause: err });
    }
}

// - application/json と、+json で終わるもの → JSON(壊れていたら 400)
// - application/x-www-form-urlencoded と multipart/form-data → フォーム
// - text/* → 文字列
// - それ以外 → ArrayBuffer
// text と bytes は Context が渡す、本文を1回だけ読む関数(c.bodyJson() / c.bodyBytes() と混ぜて呼べるように)
// raw は c.bodyBytes() を先に呼んでいたときのバイト列。そのときは、フォームもそこから読む
export async function readBody(req: Request, raw: Promise<ArrayBuffer> | undefined, text: () => Promise<string>, bytes: () => Promise<ArrayBuffer>): Promise<unknown> {
    const type = mediaType(req);
    if (type === "application/json" || type.endsWith("+json")) return parseJson(await text());
    if (type === "application/x-www-form-urlencoded" || type === "multipart/form-data") {
        const source = raw ? new Response(await raw, { headers: req.headers }) : req;
        try {
            return formToObject(await source.formData());
        } catch (err) {
            throw new HttpError(400, "400 Bad Request: Invalid form data", { cause: err });
        }
    }
    if (type.startsWith("text/")) return text();
    return bytes();
}
