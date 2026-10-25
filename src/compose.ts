import type { Context, HandlerResult, Middleware } from "./context.ts";

export type Layer = { name: string; mw: Middleware };

// 1つの層(ミドルウェアかハンドラー)にかかった時間。単位はミリ秒
// - total: その層に入ってから出るまで(下流の時間も含む)
// - self: total から next() の中で待っていた時間を引いたもの = その層「自身」の時間
// - failed: この層で例外が起きた(エラーページの「通った順番」で印を付ける)
export type Timing = { name: string; total: number; self: number; failed: boolean };

// ミドルウェアを順に通して、最後に handle を呼ぶ
// 例外は(ミドルウェアでもハンドラーでも)onError に渡してレスポンスにしてもらう
// timings を渡したときだけ、各層の時間を timings[i] に記録する(i = 層の順番、最後がハンドラー)
export function compose(
    layers: Layer[],
    c: Context,
    handle: () => Promise<Response>,
    onError: (err: unknown) => Promise<Response>,
    timings?: Timing[],
): Promise<Response> {
    // 計測しないときは時計を読まない
    const now = timings ? () => performance.now() : () => 0;
    // どの層で例外が起きたか(層の番号)
    let failedAt = -1;
    const fail = (err: unknown, i: number) => {
        failedAt = i;
        return onError(err);
    };

    const dispatch = async (i: number): Promise<Response> => {
        const start = now();
        // next() の中(下流)で待っていた時間
        let inner = 0;
        try {
            return await step(i, (ms) => (inner += ms));
        } finally {
            if (timings) {
                const total = now() - start;
                timings[i] = { name: layers[i]?.name ?? "handler", total, self: total - inner, failed: failedAt === i };
            }
        }
    };

    const step = async (i: number, addInner: (ms: number) => void): Promise<Response> => {
        const layer = layers[i];
        if (!layer) {
            try {
                return await handle();
            } catch (err) {
                return fail(err, i);
            }
        }

        // next() が返す Promise。呼ばれていなければ undefined
        let downstream: Promise<Response> | undefined;
        let result: HandlerResult | void;
        try {
            result = await layer.mw(c, () => {
                if (downstream) {
                    // 2回目を許すと、ハンドラーや後ろのミドルウェアが2回動いてしまう
                    throw new Error("next() が2回呼ばれました。1つのミドルウェアで呼べるのは1回だけです");
                }
                const nextStart = now();
                downstream = dispatch(i + 1).finally(() => addInner(now() - nextStart));
                return downstream;
            });
            // toResponse も JSON.stringify で投げることがあるので try の中で
            if (result !== undefined) return c.toResponse(result);
            // 何も返さず next() 済みなら、下流を使う(await し忘れていても、ここで待つ)
            if (downstream) return await downstream;
        } catch (err) {
            return fail(err, i);
        }

        return fail(new Error("ミドルウェアが何も返さず、next()もよんでいません"), i);
    };

    return dispatch(0);
}
