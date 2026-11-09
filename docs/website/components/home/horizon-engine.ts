// はじめようの背景を描く部分(Canvas 2D)。地平線まで続く点の道、霧、赤いリクエストの光、レーンの線
// モック(docs/design/top-page.dc.html)の Three.js の場面を、同じカメラと同じ数で、透視投影して描く
// components/home/horizon.tsx が、セクションが近づいたときに初めて読み込む

type Vec = [number, number, number];

const POINTS = 2600;
const LIGHTS = 40;
const FOV = (55 * Math.PI) / 180;
const NEAR = 0.1;
const FOG_NEAR = 8;
const FOG_FAR = 52;
const Z_BACK = -60;
const Z_FRONT = 7;
const SPAN = Z_FRONT - Z_BACK;
const TARGET: Vec = [0, 0.2, -20];
// 霧の濃さを何段階に分けて塗るか(段階ごとにまとめて塗ると速い)
const FOG_STEPS = 10;

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

export type Colors = { fg: string; accent: string };

export function createHorizon(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    // 点: x, y, z と速さ
    const px = new Float32Array(POINTS);
    const py = new Float32Array(POINTS);
    const pz = new Float32Array(POINTS);
    const ps = new Float32Array(POINTS);
    for (let i = 0; i < POINTS; i++) {
        const x = (Math.random() - 0.5) * 20;
        px[i] = x;
        py[i] = -0.7 + Math.random() * 0.12 + Math.abs(x) * 0.05;
        pz[i] = Z_BACK + Math.random() * SPAN;
        ps[i] = 0.025 + Math.random() * 0.025;
    }
    // 赤い光: 長さ 1.4 の線が、手前に飛んでくる
    const lx = new Float32Array(LIGHTS);
    const lz = new Float32Array(LIGHTS);
    const ls = new Float32Array(LIGHTS);
    for (let i = 0; i < LIGHTS; i++) {
        lx[i] = (Math.random() - 0.5) * 1.6;
        lz[i] = Z_BACK + Math.random() * SPAN;
        ls[i] = 0.16 + Math.random() * 0.14;
    }
    const cam: Vec = [0, 1.4, 7];
    let w = 1;
    let h = 1;
    let dpr = 1;

    function resize() {
        const r = canvas.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        w = Math.max(1, Math.round(r.width));
        h = Math.max(1, Math.round(r.height));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }

    // 1コマ進める(動きを止めるときは step=false で、位置を変えずに描く)
    function step() {
        for (let i = 0; i < POINTS; i++) {
            pz[i] += ps[i]!;
            if (pz[i]! > Z_FRONT) pz[i] -= SPAN;
        }
        for (let i = 0; i < LIGHTS; i++) {
            lz[i] += ls[i]!;
            if (lz[i]! > Z_FRONT) {
                lz[i] -= SPAN;
                lx[i] = (Math.random() - 0.5) * 1.6;
            }
        }
    }

    function draw(colors: Colors, mouse: { x: number; y: number }, advance: boolean) {
        if (!ctx) return;
        if (advance) step();
        // マウスに合わせて、カメラを少しずらす(視差)
        cam[0] += (mouse.x * 1.6 - cam[0]) * 0.04;
        cam[1] += (1.4 - mouse.y * 0.8 - cam[1]) * 0.04;
        const fwd = norm(sub(TARGET, cam));
        const right = norm(cross(fwd, [0, 1, 0]));
        const up = cross(right, fwd);
        const f = h / 2 / Math.tan(FOV / 2);
        const cx = w / 2;
        const cy = h / 2;
        // 点をカメラの座標にする。戻り値: 奥行き(手前にあれば正)と画面の位置
        const project = (x: number, y: number, z: number): [number, number, number] => {
            const d: Vec = [x - cam[0], y - cam[1], z - cam[2]];
            const zc = dot(d, fwd);
            return [zc, cx + (dot(d, right) * f) / zc, cy - (dot(d, up) * f) / zc];
        };
        const fogOf = (zc: number) => Math.min(1, Math.max(0, (zc - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // レーンの線(霧で奥ほど薄く。いくつかに分けて塗る)
        ctx.strokeStyle = colors.fg;
        ctx.lineWidth = 1;
        for (const x of [-1.1, 1.1]) {
            const parts = 16;
            for (let k = 0; k < parts; k++) {
                const z0 = Z_BACK + (SPAN * k) / parts;
                const z1 = Z_BACK + (SPAN * (k + 1)) / parts;
                const a = project(x, -0.66, z0);
                const b = project(x, -0.66, z1);
                if (a[0] < NEAR || b[0] < NEAR) continue;
                ctx.globalAlpha = 0.18 * (1 - fogOf((a[0] + b[0]) / 2));
                ctx.beginPath();
                ctx.moveTo(a[1], a[2]);
                ctx.lineTo(b[1], b[2]);
                ctx.stroke();
            }
        }

        // 点: 霧の濃さの段階ごとに、1つのパスにまとめて塗る
        const paths = Array.from({ length: FOG_STEPS }, () => new Path2D());
        for (let i = 0; i < POINTS; i++) {
            const [zc, sx, sy] = project(px[i]!, py[i]!, pz[i]!);
            if (zc < NEAR || sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue;
            const fog = fogOf(zc);
            if (fog >= 1) continue;
            const size = Math.max(0.7, (0.055 * f) / zc);
            paths[Math.min(FOG_STEPS - 1, Math.floor(fog * FOG_STEPS))]!.rect(sx - size / 2, sy - size / 2, size, size);
        }
        ctx.fillStyle = colors.fg;
        for (let k = 0; k < FOG_STEPS; k++) {
            ctx.globalAlpha = 0.5 * (1 - (k + 0.5) / FOG_STEPS);
            ctx.fill(paths[k]!);
        }

        // 赤い光
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        for (let i = 0; i < LIGHTS; i++) {
            const a = project(lx[i]!, -0.62, lz[i]!);
            const b = project(lx[i]!, -0.62, lz[i]! - 1.4);
            if (a[0] < NEAR || b[0] < NEAR) continue;
            ctx.globalAlpha = 0.85 * (1 - fogOf(a[0]));
            ctx.beginPath();
            ctx.moveTo(a[1], a[2]);
            ctx.lineTo(b[1], b[2]);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    resize();
    return { resize, draw };
}
