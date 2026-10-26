import type { Context, HandlerResult, Middleware } from "./context.ts";
import { markConversionError, type ConversionOrigin } from "./errors.ts";

// 返した値をレスポンスにする。失敗したら、どこが返した値だったかをエラーに覚えさせてから投げ直す
export function toResponseOf(c: Context, value: HandlerResult, origin: ConversionOrigin): Response {
    try {
        return c.toResponse(value);
    } catch (err) {
        throw markConversionError(err, origin);
    }
}

// order: 登録順(1 から)。ダッシュボードの集計に使う
export type Layer = { name: string; mw: Middleware; order?: number };

// 1つの層(ミドルウェアかハンドラー)にかかった時間。単位はミリ秒
// - total: その層に入ってから出るまで(下流の時間も含む)
// - self: total から next() の中で待っていた時間を引いたもの = その層「自身」の時間
// - failed: この層で例外が起きた(エラーページの「通った順番」で印を付ける)
// - start: リクエストの開始から、この層に入るまでの時間(ダッシュボードの玉ねぎタイムラインで棒の位置に使う)
// - stopped: next() を呼ばずに値を返して終わった(認証で 401 を返した、など。ここより内側には届いていない)
export type Timing = { name: string; total: number; self: number; failed: boolean; start: number; stopped: boolean };

// 計測するときに渡すもの(開発モードのときだけ)
export type Measure = {
    timings: Timing[];
    // リクエストの開始時刻(performance.now() の値)。start はここからの差
    origin: number;
    // いちばん内側の層の名前(handler / notFound / 405 / options / 400)
    innerName: string;
};

// ミドルウェアを順に通して、最後に handle を呼ぶ
// 例外は(ミドルウェアでもハンドラーでも)onError に渡してレスポンスにしてもらう
// measure を渡したときだけ、各層の時間を timings[i] に記録する(i = 層の順番、最後がいちばん内側)
export function compose(
    layers: Layer[],
    c: Context,
    handle: () => Response | Promise<Response>,
    onError: (err: unknown) => Promise<Response>,
    measure?: Measure,
): Promise<Response> {
    // 近道: ミドルウェアがなく、計測もしないなら、いちばん内側の処理を呼ぶだけ(下の dispatch と同じ結果になる)
    if (layers.length === 0 && !measure) {
        try {
            return Promise.resolve(handle()).catch(onError);
        } catch (err) {
            return onError(err);
        }
    }
    const timings = measure?.timings;
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
        // next() を呼ばずに値を返して終わったか
        let stopped = false;
        try {
            return await step(i, (ms) => (inner += ms), () => (stopped = true));
        } finally {
            if (measure) {
                const total = now() - start;
                measure.timings[i] = {
                    name: layers[i]?.name ?? measure.innerName,
                    total,
                    self: total - inner,
                    failed: failedAt === i,
                    start: start - measure.origin,
                    stopped,
                };
            }
        }
    };

    const step = async (i: number, addInner: (ms: number) => void, markStopped: () => void): Promise<Response> => {
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
            if (result !== undefined) {
                if (!downstream) markStopped();
                return toResponseOf(c, result, { kind: "middleware", name: layer.name });
            }
            // 何も返さず next() 済みなら、下流を使う(await し忘れていても、ここで待つ)
            if (downstream) return await downstream;
        } catch (err) {
            return fail(err, i);
        }

        return fail(new Error("ミドルウェアが何も返さず、next()もよんでいません"), i);
    };

    return dispatch(0);
}
