// OG 画像に描くワードマーク(暗い背景用)。Satori は SVG を data URL の画像として読める
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "./shared";

let cached: string | undefined;

export function OgWordmark({ height = 44 }: { height?: number }) {
    cached ??= `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public", brand.wordmarkDark)).toString("base64")}`;
    const width = Math.round((height * 155.42) / 49.38);
    return <img src={cached} width={width} height={height} alt="Senri" />;
}
