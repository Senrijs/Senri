import type { Context, HandlerResult, Middleware } from "./context.ts";

// ミドルウェアを順に通して、最後に handle を呼ぶ
// 例外は onError に渡してレスポンスにしてもらう
export function compose(
    middlewares: Middleware[],
    c: Context,
    handle: () => Promise<Response>,
    onError: (err: unknown) => Promise<Response>,
): Promise<Response> {
    const dispatch = async (i: number): Promise<Response> => {
        const mw = middlewares[i];
        if (!mw) return handle();

        // next() が返す Promise。呼ばれていなければ undefined
        let downstream: Promise<Response> | undefined;
        let result: HandlerResult | void;
        try {
            result = await mw(c, () => {
                if (downstream) {
                    // 2回目を許すと、ハンドラーや後ろのミドルウェアが2回動いてしまう
                    throw new Error("next() が2回呼ばれました。1つのミドルウェアで呼べるのは1回だけです");
                }
                downstream = dispatch(i + 1);
                return downstream;
            });
            // toResponse も JSON.stringify で投げることがあるので try の中で
            if (result !== undefined) return c.toResponse(result);
            // 何も返さず next() 済みなら、下流を使う(await し忘れていても、ここで待つ)
            if (downstream) return await downstream;
        } catch (err) {
            return onError(err);
        }

        return onError(new Error("ミドルウェアが何も返さず、next()もよんでいません"));
    };

    return dispatch(0);
}
