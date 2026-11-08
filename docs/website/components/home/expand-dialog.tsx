"use client";
// 押したカード(やボタン)の位置から広がるダイアログ。<dialog> の showModal() を使うので、
// フォーカスは中に入り、外は操作できない。Esc と外側のクリックで、来た道を逆にたどって元の位置に戻る
//
// 動き(Web Animations API。Motion のレイアウトの動きは使わない):
// - 面(.s-dlg-surface)だけを FLIP で動かす。最後の位置と大きさに置いておき、transform の translate と scale で
//   カードの位置から戻す。scale で角丸がゆがまないよう、コマごとに border-radius を scale で割り戻す
// - 1つの動きで広がる: ばね(少しだけ行き過ぎて戻る)の進み具合を 0.46 秒のコマに焼き込み、easing は linear にする
//   最初の 3 割ほどで少し上に浮き、そのまま大きくなる
// - 中身(.s-dlg-content)は動かさずに、広がりの後半から重ねてフェードイン(ゆがまない)
// - 後ろの暗くなる・ぼける動きも、同じときに始める
// - 閉じるときは、同じ道を逆にたどってカードの位置に戻る。そのまま逆に再生すると、ばねが落ち着く最後の部分から始まり、
//   一瞬止まって見えるので、閉じるときは今の位置から行き過ぎなしで戻るコマを作る。開いている途中で閉じても、そこから戻る
// - 動きを減らす設定と「動きを止める」では、動きなしで、すぐ開いてすぐ閉じる
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CloseIcon } from "./icons";
import { useStill } from "./motion";

export type Origin = { rect: DOMRect; opener: HTMLElement };

type Box = { top: number; left: number; width: number; height: number };

const DURATION = 460;
const CLOSE_DURATION = 360;
const FRAMES = 24;
const RADIUS_FROM = 20;
const RADIUS_TO = 28;
const LIFT = 10;

function target(): Box {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(880, vw - 32);
    const height = Math.min(560, vh - 64);
    return { top: Math.round((vh - height) / 2), left: Math.round((vw - width) / 2), width, height };
}

// 減衰するばね(減衰比 0.72 で、行き過ぎは 4% ほど)。t は 0〜1(DURATION の割合)
const ZETA = 0.72;
const OMEGA = 14.2 * (DURATION / 1000);
function spring(t: number): number {
    if (t >= 1) return 1;
    const wd = OMEGA * Math.sqrt(1 - ZETA * ZETA);
    const e = Math.exp(-ZETA * OMEGA * t);
    return 1 - e * (Math.cos(wd * t) + ((ZETA * OMEGA) / wd) * Math.sin(wd * t));
}

// カードの近くで少し浮く。開くときは最初の 55%(いちばん高いのは 27% のあたり)、閉じるときは最後の 55%
const liftOpen = (t: number) => -LIFT * Math.sin(Math.PI * Math.min(t / 0.55, 1));
const liftClose = (u: number) => -LIFT * Math.sin(Math.PI * Math.max((u - 0.45) / 0.55, 0));
// 閉じるときの進み方(行き過ぎなし。押した瞬間から動き出し、カードに近づくとゆっくりになる)
const easeOut = (u: number) => 1 - Math.pow(1 - u, 2.4);

// 面のコマ。progress(u) は 0(カードの位置)〜1(真ん中の大きさ)、u は 0〜1(時間の割合)
function surfaceFrames(from: DOMRect, to: Box, progress: (u: number) => number, lift: (u: number) => number): Keyframe[] {
    const sx0 = from.width / to.width;
    const sy0 = from.height / to.height;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    return Array.from({ length: FRAMES + 1 }, (_, i) => {
        const u = i / FRAMES;
        const p = progress(u);
        const sx = sx0 + (1 - sx0) * p;
        const sy = sy0 + (1 - sy0) * p;
        const r = RADIUS_FROM + (RADIUS_TO - RADIUS_FROM) * Math.min(Math.max(p, 0), 1);
        return {
            offset: u,
            transform: `translate(${(dx * (1 - p)).toFixed(2)}px, ${(dy * (1 - p) + lift(u)).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
            borderRadius: `${(r / sx).toFixed(2)}px / ${(r / sy).toFixed(2)}px`,
        };
    });
}

const CONTENT_FRAMES: Keyframe[] = [
    { offset: 0, opacity: 0, transform: "translateY(8px)" },
    { offset: 0.45, opacity: 0, transform: "translateY(8px)", easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    { offset: 0.85, opacity: 1, transform: "none" },
    { offset: 1, opacity: 1, transform: "none" },
];

// アニメーションの時計を、作ったときから動かす。ふつうは最初のコマを描き終わってから動き出すので、
// ぼかし(backdrop-filter)を描く最初のコマが重いと、カードの大きさのまま一瞬止まって見える
function pinStart(list: Animation[]): Animation[] {
    const now = document.timeline.currentTime;
    if (now !== null) for (const a of list) a.startTime = now;
    return list;
}

const BACKDROP_FRAMES: Keyframe[] = [
    { opacity: 0, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    { opacity: 1 },
];

export function ExpandDialog({
    origin,
    title,
    description,
    closeLabel,
    onClosed,
    children,
}: {
    origin: Origin;
    title: string;
    description: string;
    closeLabel: string;
    onClosed: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const backdrop = useRef<HTMLDivElement>(null);
    const anims = useRef<Animation[]>([]);
    const closing = useRef(false);
    const still = useStill();
    const [box, setBox] = useState<Box>(target);

    function open() {
        const options: KeyframeAnimationOptions = { duration: DURATION, easing: "linear", fill: "both" };
        anims.current = pinStart([
            surface.current!.animate(surfaceFrames(origin.rect, target(), spring, liftOpen), options),
            content.current!.animate(CONTENT_FRAMES, options),
            backdrop.current!.animate(BACKDROP_FRAMES, options),
        ]);
    }

    useLayoutEffect(() => {
        ref.current!.showModal();
        if (!still) open();
        return () => {
            for (const a of anims.current) a.cancel();
        };
        // 開いたときに1回だけ
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 画面の大きさが変わったら、真ん中に置き直す
    useEffect(() => {
        const onResize = () => {
            if (!closing.current) setBox(target());
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    function finish() {
        ref.current?.close();
        // カードは開いている間は隠している(visibility: hidden)ので、隠すのをやめてからフォーカスを戻す
        flushSync(onClosed);
        origin.opener.focus({ preventScroll: true });
    }

    function close() {
        if (closing.current) return;
        closing.current = true;
        if (still || anims.current.length === 0) return finish();
        // 今どこまで広がっているか(開いている途中なら、その位置から戻る)
        const time = Number(anims.current[0]!.currentTime ?? DURATION);
        const t = Math.min(time / DURATION, 1);
        const p0 = spring(t);
        const lift0 = liftOpen(t);
        const contentOpacity = Number(getComputedStyle(content.current!).opacity);
        const backdropOpacity = Number(getComputedStyle(backdrop.current!).opacity);
        for (const a of anims.current) a.cancel();
        // 戻る先は今のカードの位置(開いている間にページが動いても、そこへ戻る)
        const to = origin.opener.getBoundingClientRect();
        const duration = CLOSE_DURATION * Math.max(0.5, Math.min(p0, 1));
        const options: KeyframeAnimationOptions = { duration, easing: "linear", fill: "both" };
        anims.current = pinStart([
            surface.current!.animate(
                surfaceFrames(to, box, (u) => p0 * (1 - easeOut(u)), (u) => lift0 * (1 - Math.min(u / 0.3, 1)) + liftClose(u)),
                options,
            ),
            // 中身は最初の 35% で消える
            content.current!.animate(
                [
                    { offset: 0, opacity: contentOpacity, transform: "none", easing: "ease-out" },
                    { offset: 0.35, opacity: 0, transform: "translateY(6px)" },
                    { offset: 1, opacity: 0, transform: "translateY(6px)" },
                ],
                options,
            ),
            backdrop.current!.animate([{ opacity: backdropOpacity, easing: "ease-out" }, { opacity: 0 }], options),
        ]);
        Promise.all(anims.current.map((a) => a.finished)).then(finish, finish);
    }

    return (
        <dialog
            ref={ref}
            className="s-dialog"
            aria-labelledby="s-dialog-title"
            aria-describedby="s-dialog-desc"
            onCancel={(e) => {
                e.preventDefault();
                close();
            }}
        >
            <div ref={backdrop} className="s-dlg-backdrop" onClick={close} />
            <div className="s-dlg-panel" style={box}>
                <div ref={surface} className="s-dlg-surface" />
                <div ref={content} className="s-dlg-content">
                    <div className="head">
                        <div>
                            <h2 id="s-dialog-title" className="title">
                                {title}
                            </h2>
                            <p id="s-dialog-desc" className="desc">
                                {description}
                            </p>
                        </div>
                        <button type="button" className="x" onClick={close} aria-label={closeLabel} autoFocus>
                            <CloseIcon size={16} />
                        </button>
                    </div>
                    <div className="body">{children}</div>
                </div>
            </div>
        </dialog>
    );
}

// ヒントの `...` をコードとして出す(Senri の開発用ページと同じ書き方)
export function RichText({ text }: { text: string }) {
    return (
        <>
            {text.split(/(`[^`]+`)/).map((part, i) =>
                part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
            )}
        </>
    );
}
