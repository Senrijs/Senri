// リクエストのボディを、Content-Type に合わせて読む
import { HttpError } from "./errors.ts";

// フォームの値。同じ名前が複数あれば配列になる
export type FormValue = string | File;
export type FormBody = Record<string, FormValue | FormValue[]>;

function mediaType(req: Request): string {
    return (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

function formToObject(form: FormData): FormBody {
    const out: FormBody = {};
    for (const [name, value] of form) {
        const prev = out[name];
        if (prev === undefined) out[name] = value;
        else out[name] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    }
    return out;
}

// - application/json と、+json で終わるもの → JSON(壊れていたら 400)
// - application/x-www-form-urlencoded と multipart/form-data → フォーム
// - text/* → 文字列
// - それ以外 → ArrayBuffer
export async function readBody(req: Request): Promise<unknown> {
    const type = mediaType(req);
    if (type === "application/json" || type.endsWith("+json")) {
        const text = await req.text();
        try {
            return JSON.parse(text);
        } catch (err) {
            throw new HttpError(400, "400 Bad Request: JSON が正しくありません", { cause: err });
        }
    }
    if (type === "application/x-www-form-urlencoded" || type === "multipart/form-data") {
        try {
            return formToObject(await req.formData());
        } catch (err) {
            throw new HttpError(400, "400 Bad Request: フォームが正しくありません", { cause: err });
        }
    }
    if (type.startsWith("text/")) return req.text();
    return req.arrayBuffer();
}
