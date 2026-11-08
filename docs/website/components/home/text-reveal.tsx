"use client";
// 見出しが、ぼやけた状態から下からふわっと出てくる動き。日本語は1文字ずつ、英語は1単語ずつ
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

const container: Variants = {
    hidden: {},
    visible: (stagger: number) => ({ transition: { staggerChildren: stagger } }),
};

const item: Variants = {
    hidden: { opacity: 0, y: 20, filter: "blur(12px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: [0.2, 0.7, 0.2, 1] } },
};

export function BlurHeading({
    lines,
    lang,
    className,
    id,
    as: Tag = "h2",
}: {
    lines: string[];
    lang: Lang;
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
    const plain = lines.map((line, i) => (
        <Fragment key={i}>
            {i > 0 ? <br /> : null}
            {line}
        </Fragment>
    ));
    if (still || !animate) {
        return (
            <Tag ref={ref} id={id} className={className}>
                {plain}
            </Tag>
        );
    }

    const stagger = lang === "ja" ? 0.03 : 0.06;
    let n = 0;
    const animated: ReactNode[] = lines.map((line, i) => (
        <Fragment key={i}>
            {i > 0 ? <br /> : null}
            {segments(line, lang).map((seg) =>
                /^\s+$/.test(seg) ? (
                    <span key={n++}>{seg}</span>
                ) : (
                    <m.span key={n++} variants={item} style={{ display: "inline-block", whiteSpace: "pre" }}>
                        {seg}
                    </m.span>
                ),
            )}
        </Fragment>
    ));
    const MTag = Tag === "h2" ? m.h2 : m.p;
    return (
        <MTag
            ref={ref}
            id={id}
            className={className}
            variants={container}
            custom={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.6 }}
        >
            <span className="sr-only">{text}</span>
            <span aria-hidden="true">{animated}</span>
        </MTag>
    );
}
