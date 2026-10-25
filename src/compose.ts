import type { Context, HandlerResult, Middleware } from "./context.ts";
import { internalError, nothingReturned } from "./errors.ts";

// ミドルウェアを順に通して、最後に handle を呼ぶ
export function compose(
    middlewares: Middleware[],
    c: Context,
    handle: () => Promise<Response>,
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
            return internalError(c, err);
        }

        if (result !== undefined) return c.toResponse(result);
        if (downstream) return downstream;
        return nothingReturned();
    };

    return dispatch(0);
}
