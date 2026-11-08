// ワードマーク(Senrijs/brand の SVG)。明るい背景用と暗い背景用を置いて、テーマで片方だけ出す
// 大きさは style で決める(Tailwind の img { height: auto } に負けないように)
import { brand } from "@/lib/shared";

export function Wordmark({ height = 24 }: { height?: number }) {
    const width = Math.round((height * 155.42) / 49.38);
    return (
        <>
            <img className="s-wm-light" src={brand.wordmarkLight} alt="Senri" width={width} height={height} style={{ width, height }} />
            <img className="s-wm-dark" src={brand.wordmarkDark} alt="" width={width} height={height} style={{ width, height }} />
        </>
    );
}
