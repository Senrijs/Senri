// 標準ミドルウェアが、next() のあとでレスポンスのヘッダーを足すときに使う

// ヘッダーを変更できるレスポンスにする
// fetch() や Response.redirect() の Response はヘッダーを変更できないので、そのときだけ作り直す
export function editable(res: Response): Response {
    try {
        // 同じ値を入れ直すだけ。変更できなければここで TypeError になる
        res.headers.set("vary", res.headers.get("vary") ?? "");
        if (res.headers.get("vary") === "") res.headers.delete("vary");
        return res;
    } catch {
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    }
}

// Vary に足す(すでにあれば足さない。* なら何もしない)
export function appendVary(headers: Headers, ...names: string[]) {
    const current = headers.get("vary");
    if (current?.trim() === "*") return;
    const list = current ? current.split(",").map((v) => v.trim()).filter(Boolean) : [];
    for (const name of names) {
        if (!list.some((v) => v.toLowerCase() === name.toLowerCase())) list.push(name);
    }
    if (list.length > 0) headers.set("vary", list.join(", "));
}
