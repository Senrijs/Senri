// OG 画像(1200×630)の中身。docs/design/Og.dc.html の D 案
// - 背景は灰色(#F4F4F2)。赤い斜めの帯を一番うしろ(最初の子要素)に置く
// - 左上に senr/ のロゴと、ページの種類のラベル(TOP・DOCS・BLOG)
// - 半透明の大きな英単語が、下にはみ出す
// - タイトルと説明は、文字の右端を 330px までに収める
// 作り方は前と同じ: app/og の Route Handler が next/og の ImageResponse(Satori)で描き、静的書き出しのときに PNG のファイルになる
import { ImageResponse } from "next/og";
import { OgWordmark } from "./og-brand";
import { ogFonts } from "./og-fonts";

export type OgCard = {
    kind: "TOP" | "DOCS" | "BLOG";
    // 後ろの大きな英単語
    word: string;
    // タイトルの上の小さな行(サイトの名前、章の名前、日付など)
    meta: string;
    // タイトル。配列なら、要素ごとに改行する
    title: string | string[];
    description: string;
};

const FG = "#111418";
const MUTED = "#5B616A";
const ACCENT = "#E3412B";

export async function ogImage(card: OgCard): Promise<ImageResponse> {
    const lines = Array.isArray(card.title) ? card.title : [card.title];
    // 長いタイトルは少し小さくする(3 行を超えないように)
    const longest = Math.max(...lines.map((l) => [...l].length));
    const { fonts, family } = await ogFonts(`${card.meta}${lines.join("")}${card.description}`);
    const size = lines.length > 1 || longest <= 10 ? 74 : longest <= 16 ? 64 : 54;
    return new ImageResponse(
        <div
            style={{
                position: "relative",
                display: "flex",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background: "#F4F4F2",
                color: FG,
                fontFamily: family(400),
            }}
        >
            <div
                style={{
                    position: "absolute",
                    right: -40,
                    top: -60,
                    width: 180,
                    height: 760,
                    background: ACCENT,
                    transform: "skewX(-22deg)",
                    opacity: 0.95,
                }}
            />
            <div
                style={{
                    position: "absolute",
                    left: 56,
                    bottom: -96,
                    display: "flex",
                    fontFamily: "Inter",
                    fontWeight: 800,
                    fontSize: 260,
                    lineHeight: 1,
                    letterSpacing: "-0.06em",
                    color: "rgba(17,20,24,0.07)",
                    whiteSpace: "nowrap",
                }}
            >
                {card.word}
            </div>
            <div style={{ position: "absolute", left: 80, top: 72, display: "flex", alignItems: "center", gap: 20 }}>
                <OgWordmark height={40} />
                <div style={{ width: 2, height: 28, background: "#D5D7DB" }} />
                <div style={{ fontFamily: "JetBrains Mono", fontWeight: 600, fontSize: 22, letterSpacing: "0.12em", color: ACCENT }}>{card.kind}</div>
            </div>
            <div style={{ position: "absolute", left: 80, top: 178, right: 330, display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: family(500), fontWeight: 500, fontSize: 24, color: MUTED }}>{card.meta}</div>
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", fontFamily: family(900), fontWeight: 900, fontSize: size, lineHeight: 1.2, letterSpacing: "-0.01em", wordBreak: "keep-all" }}>
                    {lines.map((line) => (
                        <div key={line} style={{ display: "flex", flexWrap: "wrap" }}>
                            {line}
                        </div>
                    ))}
                </div>
                {card.description ? (
                    <div style={{ marginTop: 24, maxWidth: 760, fontFamily: family(400), fontWeight: 400, fontSize: 25, lineHeight: 1.6, color: MUTED, wordBreak: "keep-all" }}>{card.description}</div>
                ) : null}
            </div>
        </div>,
        {
            width: 1200,
            height: 630,
            fonts,
        },
    );
}
