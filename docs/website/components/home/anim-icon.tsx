"use client";
// 触ると少し動くアイコン。useAnimations(react-useanimations、MIT、https://useanimations.com)の再生エンジンとアイコン
// - 最初は止まったアイコン(fallback)を出し、描き終わってブラウザが空いたときに、再生エンジンとアイコンを読み込んで差し替える
//   (最初に読む JavaScript には入れない)
// - 動きを減らす設定と「動きを止める」では、止まったアイコンのまま
// - 飾りなので読み上げない。ボタンの名前は、今までどおりボタンの aria-label で付ける
import type { Interaction } from "react-useanimations";
import { type ReactNode, useEffect, useState } from "react";
import { useStill } from "./motion";

type Name = "menu" | "copy" | "checkmark" | "sun" | "moon" | "star";
type Loaded = {
    Player: typeof import("react-useanimations").default;
    icons: Record<Name, import("react-useanimations").Animation>;
};

let cache: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
    loading ??= Promise.all([
        import("react-useanimations"),
        import("react-useanimations/lib/menu"),
        import("react-useanimations/lib/copy"),
        import("react-useanimations/lib/checkmark"),
        import("react-useanimations/lib/sun"),
        import("react-useanimations/lib/moon"),
        import("react-useanimations/lib/star"),
    ]).then(([player, menu, copy, checkmark, sun, moon, star]) => {
        cache = {
            Player: player.default,
            icons: { menu: menu.default, copy: copy.default, checkmark: checkmark.default, sun: sun.default, moon: moon.default, star: star.default },
        };
        return cache;
    });
    return loading;
}

// ブラウザが空いたときに呼ぶ(requestIdleCallback がないブラウザでは少し待つ)
function whenIdle(run: () => void): () => void {
    if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(run, { timeout: 3000 });
        return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
}

export function AnimIcon({
    name,
    fallback,
    size = 16,
    active,
    interaction,
    loop,
}: {
    name: Name;
    fallback: ReactNode;
    size?: number;
    active?: boolean;
    interaction?: Interaction;
    loop?: boolean;
}) {
    const still = useStill();
    const [loaded, setLoaded] = useState<Loaded | null>(cache);

    useEffect(() => {
        if (still || loaded) return;
        let alive = true;
        const cancel = whenIdle(() => {
            load().then((l) => alive && setLoaded(l));
        });
        return () => {
            alive = false;
            cancel();
        };
    }, [still, loaded]);

    if (still || !loaded) return <>{fallback}</>;
    const { Player, icons } = loaded;
    return (
        <span className="s-anim-icon" aria-hidden="true">
            <Player animation={icons[name]} size={size} active={active} interaction={interaction} loop={loop} />
        </span>
    );
}
