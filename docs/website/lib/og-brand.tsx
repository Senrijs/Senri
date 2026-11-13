// OG 画像に描くワードマーク。Satori は SVG を data URL の画像として読める
// 明るい背景(D 案の灰色)には、黒い文字の版(wordmarkLight)を使う
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "./shared";

const cached = new Map<string, string>();

export function OgWordmark({ height = 40, onDark = false }: { height?: number; onDark?: boolean }) {
    const file = onDark ? brand.wordmarkDark : brand.wordmarkLight;
    let src = cached.get(file);
    if (!src) {
        src = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", file)).toString("base64")}`;
        cached.set(file, src);
    }
    const width = Math.round((height * 155.42) / 49.38);
    return <img src={src} width={width} height={height} alt="Senri" />;
}
