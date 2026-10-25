// ダッシュボードに出す、リクエスト1件分の記録を作る
import type { Context } from "../../context.ts";
import { buildErrorPageData } from "../error-page.ts";
import type { ErrorPageData } from "../page-data.ts";
import { maskHeaders } from "./mask.ts";

// 玉ねぎタイムラインでの、層の状態
// - ok: 通過した(next() を呼んで下流に渡した、またはいちばん内側で処理した)
// - stopped: next() を呼ばずに値を返して終わった(ここより内側には届いていない)
// - failed: この層で例外が起きた
// - skipped: 外側の層で止まったので、届かなかった(未到達)
export type LayerState = "ok" | "stopped" | "failed" | "skipped";

export type RecordLayer = {
    name: string;
    // 外側から何番目か(0 がいちばん外側)。画面での字下げに使う
    depth: number;
    // リクエストの開始からの時刻と、かかった時間(ミリ秒)。未到達なら 0
    start: number;
    total: number;
    self: number;
    state: LayerState;
};

export type DashboardRecord = {
    id: string;
    // 受け付けた時刻(エポックミリ秒)
    time: number;
    method: string;
    path: string;
    query: string;
    route: string | null;
    params: Record<string, string>;
    status: number;
    durationMs: number;
    layers: RecordLayer[];
    // 機密ヘッダーは *** に伏せてある
    requestHeaders: [string, string][];
    responseHeaders: [string, string][];
    // 5xx のときだけ、エラーページと同じ中身
    error: ErrorPageData | null;
};

function requestPath(c: Context): { path: string; query: string } {
    let query = "";
    try {
        query = new URL(c.req.url).search;
    } catch {
        // URL として読めなくても記録はする
    }
    try {
        return { path: c.path, query };
    } catch {
        // デコードできないパス(400)は、届いたままのものを出す
        return { path: c.req.url, query };
    }
}

export async function buildRecord(input: {
    id: string;
    time: number;
    c: Context;
    res: Response;
    // この リクエストで通るはずだった層の名前(外側から。最後がいちばん内側)
    layerNames: string[];
}): Promise<DashboardRecord> {
    const { id, time, c, res, layerNames } = input;

    const layers: RecordLayer[] = layerNames.map((name, depth) => {
        const t = c.timings[depth];
        // 計測がない = そこまで届かなかった
        if (!t) return { name, depth, start: 0, total: 0, self: 0, state: "skipped" };
        const state: LayerState = t.failed ? "failed" : t.stopped ? "stopped" : "ok";
        return { name, depth, start: t.start, total: t.total, self: t.self, state };
    });

    // 5xx で、例外が残っていれば(意図した 4xx の HttpError は c.error に入らない)、エラーページと同じ中身を取っておく
    const error = res.status >= 500 && c.error !== undefined ? await buildErrorPageData(c.error, c, res) : null;

    return {
        id,
        time,
        method: c.req.method,
        ...requestPath(c),
        route: c.route ?? null,
        params: c.params,
        status: res.status,
        durationMs: c.timings[0]?.total ?? 0,
        layers,
        requestHeaders: maskHeaders(c.req.headers),
        responseHeaders: maskHeaders(res.headers),
        error,
    };
}
