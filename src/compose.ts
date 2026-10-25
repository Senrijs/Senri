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

        let downstream: Response | undefined;
        let result: HandlerResult | void;
        try {
            result = await mw(c, async () => {
                downstream = await dispatch(i + 1);
                return downstream;
            });
        } catch (err) {
            return onError(err);
        }

        if (result !== undefined) return c.toResponse(result);
        if (downstream) return downstream;
        return onError(new Error("ミドルウェアが何も返さず、next()もよんでいません"));
    };

    return dispatch(0);
}
