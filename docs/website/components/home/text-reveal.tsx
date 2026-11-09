"use client";
// 見出しが、ぼやけた状態から下からふわっと出てくる動き。日本語は1文字ずつ、英語は1単語ずつ(巨大な英語は1文字ずつ)
// - BlurHeading(h2): 画面に入ったときに1回だけ。Motion で動かす
//   Motion Primitives の TextEffect(preset "fade-in-blur")を元に、使う分だけに縮めたもの
//   https://github.com/ibelick/motion-primitives/blob/120f64f6ca60348e251f929e9c81f11ccbe45eda/components/core/text-effect.tsx
//   MIT License, Copyright (c) 2024 ibelick(https://github.com/ibelick/motion-primitives/blob/main/LICENCE.md)
// - 読み上げは、分ける前の文をそのまま読む(見えない文を置き、分けた文字は aria-hidden)
// - 最初に描くときと、動きを止めるときは、ふつうの文字のまま。最初から画面に見えている見出しも動かさない(ちらつかないように)
import * as m from "motion/react-m";
import type { Variants } from "motion/react";
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { segments } from "@/lib/home/segments";
import { useStill } from "./motion";

// 動きの決まり(ヒーローの見出しの CSS .s-blur-seg と同じ):
// 透明・ぼかし 12px・0.35em 下 → 不透明・ぼかしなし・元の位置。1つ 0.7 秒、40ms ずつずらす
// 巨大な英語(big)だけは、大きい文字で動きすぎないよう 0.15em 下から
const STAGGER = 0.04;
const EASE = [0.2, 0.7, 0.2, 1] as const;

const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: STAGGER } },
};

// will-change は動いている間だけ付けて、終わったら外す(transitionEnd)
function blurItem(offset: string): Variants {
    return {
        hidden: { opacity: 0, y: offset, filter: "blur(12px)", willChange: "transform, opacity, filter" },
        visible: {
            opacity: 1,
            y: "0em",
            filter: "blur(0px)",
            transition: { duration: 0.7, ease: EASE },
            transitionEnd: { willChange: "auto" },
        },
    };
}
const item = blurItem("0.35em");
const bigItem = blurItem("0.15em");

// 1つの区切りを動かす部品にする(空白は動かさない)
function animatedSegments(list: string[], start: number, variants: Variants = item): ReactNode[] {
    return list.map((seg, i) =>
        /^\s+$/.test(seg) ? (
            <span key={start + i}>{seg}</span>
        ) : (
            <m.span key={start + i} variants={variants} style={{ display: "inline-block", whiteSpace: "pre" }}>
                {seg}
            </m.span>
        ),
    );
}

// big: セクションの上に置く巨大な英語(TRY IT など)。飾りなので読み上げない(aria-hidden)
// 1単語だけの見出し(RUNTIMES など)でも流れて見えるよう、1文字ずつ出す
// big があるときは、日本語(英語)の一言を1行で出す
export function BlurHeading({
    lines,
    lang,
    big,
    className,
    id,
    as: Tag = "h2",
}: {
    lines: string[];
    lang: Lang;
    big?: string;
    className?: string;
    id?: string;
    as?: "h2" | "p";
}) {
    const still = useStill();
    const ref = useRef<HTMLHeadingElement>(null);
    const [animate, setAnimate] = useState(false);

    // 描いたときに画面の下にある見出しだけ動かす
    useLayoutEffect(() => {
        if (still || !ref.current) return;
        setAnimate(ref.current.getBoundingClientRect().top > window.innerHeight);
    }, [still]);

    const text = lines.join(lang === "ja" ? "" : " ");
    const rows = big ? [text] : lines;
    if (still || !animate) {
        return (
            <Tag ref={ref} id={id} className={className}>
                {big ? (
                    <span className="s-big" aria-hidden="true">
                        {big}
                    </span>
                ) : null}
                {rows.map((line, i) => (
                    <Fragment key={i}>
                        {i > 0 ? <br /> : null}
                        {line}
                    </Fragment>
                ))}
            </Tag>
        );
    }

    let n = 0;
    const bigSegs = big ? Array.from(big) : [];
    const bigNode = big ? (
        <span className="s-big" aria-hidden="true">
            {animatedSegments(bigSegs, 0, bigItem)}
        </span>
    ) : null;
    n = bigSegs.length;
    const animated: ReactNode[] = rows.map((line, i) => {
        const segs = segments(line, lang);
        const node = (
            <Fragment key={`r${i}`}>
                {i > 0 ? <br /> : null}
                {animatedSegments(segs, n)}
            </Fragment>
        );
        n += segs.length;
        return node;
    });
    const MTag = Tag === "h2" ? m.h2 : m.p;
    return (
        <MTag
            ref={ref}
            id={id}
            className={className}
            variants={container}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: big ? 0.3 : 0.6 }}
        >
            {bigNode}
            <span className="sr-only">{text}</span>
            <span aria-hidden="true">{animated}</span>
        </MTag>
    );
}
