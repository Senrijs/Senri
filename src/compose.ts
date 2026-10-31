import type { Context, HandlerResult, Middleware } from "./context.ts";
import { markConversionError, senriError, type ConversionOrigin } from "./errors.ts";

// 返した値をレスポンスにする。失敗したら、どこが返した値だったかをエラーに覚えさせてから投げ直す
export function toResponseOf(c: Context, value: HandlerResult, origin: ConversionOrigin): Response {
    try {
        return c.toResponse(value);
    } catch (err) {
        throw markConversionError(err, origin);
    }
}

// order: 登録順(1 から)。ダッシュボードの集計に使う
/**
 * A middleware in the chain for a request. Used by `@senrijs/senri/dev`; app code does not normally use it.
 */
export type Layer = {
    /** The middleware's name (function name, or `anonymous#N`). */
    name: string;
    /** The middleware. */
    mw: Middleware;
    /** Registration order, from 1. */
    order?: number;
};

// 1つの層(ミドルウェアかハンドラー)にかかった時間。単位はミリ秒
// - total: その層に入ってから出るまで(下流の時間も含む)
// - self: total から next() の中で待っていた時間を引いたもの = その層「自身」の時間
// - failed: この層で例外が起きた(エラーページの「通った順番」で印を付ける)
// - start: リクエストの開始から、この層に入るまでの時間(ダッシュボードの玉ねぎタイムラインで棒の位置に使う)
// - stopped: next() を呼ばずに値を返して終わった(認証で 401 を返した、など。ここより内側には届いていない)
/** Time spent in one layer (middleware or the handler), in milliseconds. See `c.timings`. */
export type Timing = {
    /** The layer's name. */
    name: string;
    /** From entering the layer to leaving it, including inner layers. */
    total: number;
    /** `total` minus the time spent waiting in `next()`. */
    self: number;
    /** An error was thrown in this layer. */
    failed: boolean;
    /** From the start of the request to entering this layer. */
    start: number;
    /** The layer returned a value without calling `next()`. */
    stopped: boolean;
};

// 開発モードの計測のためのフック(@senrijs/senri/dev が実装する)。本番では渡さないので、時計も読まない
// i は層の番号(0 から。最後がいちばん内側の処理)
/**
 * Hooks for measuring each layer, implemented by `@senrijs/senri/dev`. `i` is the layer index, from 0;
 * the last one is the innermost step. App code does not normally use it.
 */
export type Trace = {
    // 層 i に入った
    /** Layer `i` was entered. */
    enter(i: number): void;
    // 層 i が next() を呼んだ。返した関数は、下流が終わったときに呼ぶ
    /** Layer `i` called `next()`. The returned function is called when the downstream finishes. */
    down(i: number): () => void;
    // 層 i から出た。failed: この層で例外が起きた / stopped: next() を呼ばずに値を返した
    /** Layer `i` was left. `failed`: an error was thrown in it. `stopped`: it returned without calling `next()`. */
    leave(i: number, failed: boolean, stopped: boolean): void;
};

// ミドルウェアを順に通して、最後に handle を呼ぶ
// 例外は(ミドルウェアでもハンドラーでも)onError に渡してレスポンスにしてもらう
export function compose(
    layers: Layer[],
    c: Context,
    handle: () => Response | Promise<Response>,
    onError: (err: unknown) => Promise<Response>,
    trace?: Trace,
): Promise<Response> {
    // 近道: ミドルウェアがなく、計測もしないなら、いちばん内側の処理を呼ぶだけ(下の dispatch と同じ結果になる)
    if (layers.length === 0 && !trace) {
        try {
            return Promise.resolve(handle()).catch(onError);
        } catch (err) {
            return onError(err);
        }
    }
    // どの層で例外が起きたか(層の番号)
    let failedAt = -1;
    const fail = (err: unknown, i: number) => {
        failedAt = i;
        return onError(err);
    };

    const dispatch = async (i: number): Promise<Response> => {
        trace?.enter(i);
        // next() を呼ばずに値を返して終わったか
        let stopped = false;
        try {
            return await step(i, () => (stopped = true));
        } finally {
            trace?.leave(i, failedAt === i, stopped);
        }
    };

    const step = async (i: number, markStopped: () => void): Promise<Response> => {
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
                // 2回目を許すと、ハンドラーや後ろのミドルウェアが2回動いてしまう
                if (downstream) throw senriError("next_twice", "next() called twice");
                // 下流に入る時刻は、dispatch を始める前に取る(下流が最初の await までに同期で使った時間も、下流の時間にする)
                const up = trace?.down(i);
                const d = dispatch(i + 1);
                downstream = up ? d.finally(up) : d;
                return downstream;
            });
            // toResponse も JSON.stringify で投げることがあるので try の中で
            if (result !== undefined) {
                if (!downstream) markStopped();
                return toResponseOf(c, result, { kind: "middleware", name: layer.name });
            }
            // 何も返さず next() 済みなら、下流を使う(await し忘れていても、ここで待つ)
            if (downstream) return await downstream;
        } catch (err) {
            return fail(err, i);
        }

        return fail(senriError("no_response", "Middleware returned nothing and did not call next()"), i);
    };

    return dispatch(0);
}
