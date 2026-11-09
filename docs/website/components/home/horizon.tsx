"use client";
// はじめようの背景。地平線まで続く点の道を、赤いリクエストの光が飛んでくる(Canvas 2D。npm の three は使わない)
// - 描く部分(horizon-engine.ts)は、セクションの 600px 手前まで来たときに初めて読み込む(最初に読む JavaScript に入れない)
// - 描くのは、画面に入っていて、タブが前にあるときだけ
// - 色はテーマに合わせる(テーマが変わったときだけ読み直す)
// - 動きを止める設定では、1コマだけ描く
// - 飾りなので読み上げない
import { useEffect, useRef } from "react";
import { useStill } from "./motion";

const ACCENT = "#E3412B";

export function Horizon() {
    const ref = useRef<HTMLCanvasElement>(null);
    const still = useStill();

    useEffect(() => {
        const canvas = ref.current!;
        const section = canvas.closest("section") ?? canvas.parentElement!;
        let engine: Awaited<ReturnType<typeof import("./horizon-engine").createHorizon>> | null = null;
        let raf = 0;
        let visible = false;
        let disposed = false;
        let colors = { fg: "#111418", accent: ACCENT };
        const mouse = { x: 0, y: 0 };

        const readColors = () => {
            const cs = getComputedStyle(canvas);
            colors = { fg: cs.getPropertyValue("--fg").trim() || colors.fg, accent: ACCENT };
        };
        const running = () => !still && visible && !document.hidden;
        const loop = () => {
            raf = 0;
            if (!engine) return;
            engine.draw(colors, mouse, true);
            if (running()) raf = requestAnimationFrame(loop);
        };
        const resume = () => {
            if (!engine) return;
            if (still) {
                engine.draw(colors, mouse, false);
                return;
            }
            if (!raf && running()) raf = requestAnimationFrame(loop);
        };

        // 近づいたら読み込む
        const near = new IntersectionObserver(
            ([entry]) => {
                if (!entry!.isIntersecting || engine) return;
                near.disconnect();
                import("./horizon-engine").then(({ createHorizon }) => {
                    if (disposed) return;
                    readColors();
                    engine = createHorizon(canvas);
                    resume();
                });
            },
            { rootMargin: "600px 0px" },
        );
        near.observe(section);
        // 画面に入っているときだけ描く
        const io = new IntersectionObserver(([entry]) => {
            visible = entry!.isIntersecting;
            resume();
        });
        io.observe(section);
        const ro = new ResizeObserver(() => {
            if (!engine) return;
            engine.resize();
            if (still) engine.draw(colors, mouse, false);
        });
        ro.observe(canvas);
        const mo = new MutationObserver(() => {
            readColors();
            if (still && engine) engine.draw(colors, mouse, false);
        });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        const onMove = (e: MouseEvent) => {
            const r = section.getBoundingClientRect();
            mouse.x = (e.clientX - r.left) / r.width - 0.5;
            mouse.y = (e.clientY - r.top) / r.height - 0.5;
        };
        section.addEventListener("mousemove", onMove);
        document.addEventListener("visibilitychange", resume);

        return () => {
            disposed = true;
            cancelAnimationFrame(raf);
            near.disconnect();
            io.disconnect();
            ro.disconnect();
            mo.disconnect();
            section.removeEventListener("mousemove", onMove);
            document.removeEventListener("visibilitychange", resume);
        };
    }, [still]);

    return <canvas ref={ref} className="s-horizon" aria-hidden="true" />;
}
