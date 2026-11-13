"use client";
// 「はじめよう」の背景(Canvas 2D)。24px 間隔の点の上を、赤いリクエストが点から点へ曲がりながら進む
// - 頭が外に出ても、残像が全部外に抜けるまでは消さない
// - マウスの近くの点は、少し大きく濃くなる。真ん中は背景の色でぼかす
// - 色は CSS の変数から読む(テーマを切り替えると変わる)
// - 画面の外やタブが裏のときは、コマを描かない(requestAnimationFrame を止める)
// - 動きを止める設定では、点だけを 1 回描いて止める
import { useEffect, useRef } from "react";
import { useStill } from "./still";

const S = 24;

type Shot = { i: number; j: number; di: number; dj: number; p: number; v: number; trail: [number, number][] };

function rgb(color: string): [number, number, number] {
    const m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(color);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    const h = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (h) return [0, 2, 4].map((k) => Number.parseInt(h[1]!.slice(k, k + 2), 16)) as [number, number, number];
    return [255, 255, 255];
}

export function Dots() {
    const ref = useRef<HTMLCanvasElement>(null);
    const still = useStill();

    useEffect(() => {
        const cv = ref.current!;
        const box = cv.parentElement!;
        let shots: Shot[] = [];
        let mouse: { x: number; y: number } | null = null;
        let raf = 0;
        let visible = false;

        const draw = () => {
            const dpr = Math.min(1.5, window.devicePixelRatio || 1);
            const w = cv.clientWidth;
            const h = cv.clientHeight;
            if (w === 0 || h === 0) return;
            if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
                cv.width = Math.round(w * dpr);
                cv.height = Math.round(h * dpr);
            }
            const g = cv.getContext("2d")!;
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, w, h);
            const css = getComputedStyle(cv);
            const dot = css.getPropertyValue("--plus").trim() || "#9aa0a8";
            const [ar, ag, ab] = rgb(css.getPropertyValue("--accent").trim() || "#e3412b");
            const [br, bg, bb] = rgb(css.getPropertyValue("--bg").trim() || "#ffffff");

            const ox = (w % S) / 2 + S / 2;
            const oy = (h % S) / 2 + S / 2;
            const cols = Math.floor(w / S);
            const rows = Math.floor(h / S);
            g.fillStyle = dot;
            for (let j = 0; j < rows; j++)
                for (let i = 0; i < cols; i++) {
                    const x = ox + i * S;
                    const y = oy + j * S;
                    let r = 1.2;
                    let a = 0.5;
                    if (mouse) {
                        const d = Math.hypot(x - mouse.x, y - mouse.y);
                        if (d < 110) {
                            const k = 1 - d / 110;
                            r += k * 1.4;
                            a += k * 0.45;
                        }
                    }
                    g.globalAlpha = a;
                    g.fillRect(x - r, y - r, r * 2, r * 2);
                }

            if (!still) {
                if (shots.length < 7 && rows > 2 && Math.random() < 0.03) {
                    const fromLeft = Math.random() < 0.5;
                    shots.push({ i: fromLeft ? -1 : cols, j: 1 + Math.floor(Math.random() * (rows - 2)), di: fromLeft ? 1 : -1, dj: 0, p: 0, v: 0.12 + Math.random() * 0.1, trail: [] });
                }
                const inb = (i: number, j: number) => i >= -1 && i <= cols && j >= -1 && j <= rows;
                shots = shots.filter((q) => inb(q.i, q.j) || q.trail.some(([i, j]) => inb(i, j)));
                for (const q of shots) {
                    q.p += q.v;
                    while (q.p >= 1) {
                        q.p -= 1;
                        q.trail.push([q.i, q.j]);
                        if (q.trail.length > 6) q.trail.shift();
                        q.i += q.di;
                        q.j += q.dj;
                        if (inb(q.i, q.j) && Math.random() < 0.12) {
                            if (q.dj === 0) {
                                q.dj = Math.random() < 0.5 ? 1 : -1;
                                q.di = 0;
                            } else {
                                q.dj = 0;
                                q.di = Math.random() < 0.5 ? 1 : -1;
                            }
                        }
                    }
                    const hx = ox + (q.i + q.di * q.p) * S;
                    const hy = oy + (q.j + q.dj * q.p) * S;
                    const pts = q.trail.map(([i, j]) => [ox + i * S, oy + j * S] as const).concat([[ox + q.i * S, oy + q.j * S], [hx, hy]]);
                    g.globalAlpha = 1;
                    g.lineWidth = 2;
                    g.lineCap = "round";
                    g.lineJoin = "round";
                    for (let k = 1; k < pts.length; k++) {
                        g.strokeStyle = `rgba(${ar},${ag},${ab},${(0.08 + (0.8 * k) / pts.length).toFixed(2)})`;
                        g.beginPath();
                        g.moveTo(pts[k - 1]![0], pts[k - 1]![1]);
                        g.lineTo(pts[k]![0], pts[k]![1]);
                        g.stroke();
                    }
                    g.fillStyle = `rgba(${ar},${ag},${ab},.35)`;
                    for (const [i, j] of q.trail) g.fillRect(ox + i * S - 1.6, oy + j * S - 1.6, 3.2, 3.2);
                    g.fillStyle = `rgb(${ar},${ag},${ab})`;
                    g.fillRect(hx - 3, hy - 3, 6, 6);
                }
            }

            const fade = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.45);
            fade.addColorStop(0, `rgba(${br},${bg},${bb},.92)`);
            fade.addColorStop(0.55, `rgba(${br},${bg},${bb},.55)`);
            fade.addColorStop(1, `rgba(${br},${bg},${bb},0)`);
            g.globalAlpha = 1;
            g.fillStyle = fade;
            g.fillRect(0, 0, w, h);
        };

        const frame = () => {
            raf = 0;
            draw();
            if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame);
        };
        const kick = () => {
            if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
        };
        const halt = () => {
            cancelAnimationFrame(raf);
            raf = 0;
        };

        const io = new IntersectionObserver(([e]) => {
            visible = e!.isIntersecting;
            if (visible) kick();
            else halt();
        });
        io.observe(cv);
        const onVis = () => (document.hidden ? halt() : kick());
        document.addEventListener("visibilitychange", onVis);
        // 止めているときは、マウスや大きさやテーマが変わったときだけ描き直す
        const onMove = (e: PointerEvent) => {
            const r = cv.getBoundingClientRect();
            mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
            if (still) kick();
        };
        const onLeave = () => {
            mouse = null;
            if (still) kick();
        };
        box.addEventListener("pointermove", onMove);
        box.addEventListener("pointerleave", onLeave);
        const ro = new ResizeObserver(() => kick());
        ro.observe(cv);
        const mo = new MutationObserver(() => kick());
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        return () => {
            halt();
            io.disconnect();
            ro.disconnect();
            mo.disconnect();
            document.removeEventListener("visibilitychange", onVis);
            box.removeEventListener("pointermove", onMove);
            box.removeEventListener("pointerleave", onLeave);
        };
    }, [still]);

    return <canvas ref={ref} className="dots" aria-hidden="true" />;
}
