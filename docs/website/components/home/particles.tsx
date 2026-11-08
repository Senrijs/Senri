"use client";
// ヒーローの背景のパーティクル。マウスから逃げて、近くのものはアクセント色になる
// 画面の外にあるときとタブが裏にあるときは止める。動きを止める設定では、1回だけ描く
import { useEffect, useRef } from "react";
import { useStill } from "./motion";

type P = { x: number; y: number; vx: number; vy: number; dx: number; dy: number; r: number };

const ACCENT = "#E3412B";
const REPEL = 140;

export function Particles() {
    const ref = useRef<HTMLCanvasElement>(null);
    const still = useStill();

    useEffect(() => {
        const cv = ref.current!;
        const section = cv.parentElement!;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        let ps: P[] | null = null;
        let mouse = { x: -9999, y: -9999 };
        let raf = 0;
        let visible = true;

        const onMove = (e: MouseEvent) => {
            const r = cv.getBoundingClientRect();
            mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const onLeave = () => {
            mouse = { x: -9999, y: -9999 };
        };

        function frame() {
            const r = cv.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.round(r.width));
            const h = Math.max(1, Math.round(r.height));
            if (cv.width !== w * dpr || cv.height !== h * dpr) {
                cv.width = w * dpr;
                cv.height = h * dpr;
                ps = null;
            }
            if (!ps) {
                const n = Math.min(170, Math.round((w * h) / 7000));
                ps = Array.from({ length: n }, () => {
                    const a = Math.random() * Math.PI * 2;
                    return { x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, dx: Math.cos(a) * 0.18, dy: Math.sin(a) * 0.18, r: Math.random() * 1.3 + 0.7 };
                });
            }
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx!.clearRect(0, 0, w, h);
            const base = getComputedStyle(cv).getPropertyValue("--particle").trim() || "rgba(17,20,24,0.22)";
            for (const p of ps) {
                const ox = p.x - mouse.x;
                const oy = p.y - mouse.y;
                const d2 = ox * ox + oy * oy;
                if (!still && d2 < REPEL * REPEL) {
                    const d = Math.sqrt(d2) || 1;
                    const f = (REPEL - d) / REPEL;
                    p.vx += (ox / d) * f * 0.9;
                    p.vy += (oy / d) * f * 0.9;
                }
                if (!still) {
                    p.vx += (p.dx - p.vx) * 0.04;
                    p.vy += (p.dy - p.vy) * 0.04;
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x < -10) p.x = w + 10;
                    if (p.x > w + 10) p.x = -10;
                    if (p.y < -10) p.y = h + 10;
                    if (p.y > h + 10) p.y = -10;
                }
                const near = d2 < 40000;
                ctx!.fillStyle = near ? ACCENT : base;
                ctx!.beginPath();
                ctx!.arc(p.x, p.y, near ? p.r + 0.7 : p.r, 0, Math.PI * 2);
                ctx!.fill();
            }
        }

        function loop() {
            frame();
            raf = visible && !document.hidden && !still ? requestAnimationFrame(loop) : 0;
        }
        const resume = () => {
            if (!raf && visible && !document.hidden && !still) raf = requestAnimationFrame(loop);
        };

        const io = new IntersectionObserver(([entry]) => {
            visible = entry!.isIntersecting;
            resume();
        });
        io.observe(cv);
        document.addEventListener("visibilitychange", resume);
        section.addEventListener("mousemove", onMove);
        section.addEventListener("mouseleave", onLeave);
        // テーマが変わったら色を描き直す(止まっているとき)
        const mo = new MutationObserver(() => still && frame());
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        raf = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(raf);
            io.disconnect();
            mo.disconnect();
            document.removeEventListener("visibilitychange", resume);
            section.removeEventListener("mousemove", onMove);
            section.removeEventListener("mouseleave", onLeave);
        };
    }, [still]);

    return <canvas ref={ref} aria-hidden="true" />;
}
