"use client";
// トップページの Motion の土台。機能(domAnimation)は描いたあとで読み込み、m.* の部品だけを使う(strict)
// 止め方: フッターの「動きを止める」では全部止める。ふだんは OS の「視差効果を減らす」に従う
// Motion の reducedMotion は transform だけを止めるので、ぼかしと透明度は、部品ごとに useStill() を見て止める
import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useMotionOff } from "./motion";

const features = () => import("./motion-features").then((m) => m.default);

export function MotionRoot({ children }: { children: ReactNode }) {
    const off = useMotionOff();
    return (
        <LazyMotion features={features} strict>
            <MotionConfig reducedMotion={off ? "always" : "user"}>{children}</MotionConfig>
        </LazyMotion>
    );
}
