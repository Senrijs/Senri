// 見出しを 1 文字ずつ浮かび上がらせる(下から少し上がりながら、ぼかしが取れる)
// - 文字ごとの span は、ふつうの inline のまま。inline-block にしないので、改行の位置(keep-all を含む)は変わらない
//   下からの動きは transform ではなく position: relative の top で付ける(inline の要素には transform が効かない)
// - 見出しの中の色や強調(子の要素)は、そのまま残して中の文字だけを分ける
// - 読み上げ: 見出しには文字列全体(.sr-only)を読ませ、1 文字ずつの span は aria-hidden にする
// - 動かすのは、GridShell の先頭のスクリプト(REVEAL_SCRIPT)。画面に入ったら data-rv="in" にする(1 回だけ)
//   文字を隠す CSS は <html class="rv"> のときだけ効く(top.css)。JS が動かない・動きを減らす設定では、最初から見えている
// クライアントの部品(PATTERNS など)の中でも使えるよう、フックは使わない
import { Children, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";

// 1 文字の動きのずれ(ms)。長い見出しでも、最後の文字が MAX_START ms までに動き出すように縮める
const STEP = 35;
const MAX_START = 800;

function count(node: ReactNode): number {
    let n = 0;
    Children.forEach(node, (c) => {
        if (typeof c === "string" || typeof c === "number") n += [...String(c)].filter((ch) => !/\s/.test(ch)).length;
        else if (isValidElement<{ children?: ReactNode }>(c)) n += count(c.props.children);
    });
    return n;
}

function text(node: ReactNode): string {
    let s = "";
    Children.forEach(node, (c) => {
        if (typeof c === "string" || typeof c === "number") s += String(c);
        else if (isValidElement<{ children?: ReactNode }>(c)) s += c.type === "br" ? " " : text(c.props.children);
    });
    return s;
}

function split(node: ReactNode, state: { i: number; step: number }): ReactNode {
    return Children.map(node, (c) => {
        if (typeof c === "string" || typeof c === "number") {
            // 空白は span にしない(改行できる位置をそのまま残す)
            return [...String(c)].map((ch, k) =>
                /\s/.test(ch) ? (
                    ch
                ) : (
                    <span key={k} className="rvc" style={{ "--d": `${Math.round(state.i++ * state.step)}ms` } as React.CSSProperties}>
                        {ch}
                    </span>
                ),
            );
        }
        if (isValidElement<{ children?: ReactNode }>(c) && c.props.children !== undefined) {
            return cloneElement(c as ReactElement<{ children?: ReactNode }>, undefined, split(c.props.children, state));
        }
        return c;
    });
}

type Props = {
    as?: "h1" | "h2" | "p";
    className?: string;
    id?: string;
    // 読み上げる文字列(見た目の文字列と違うとき。例: 「TRY IT — その場で、試してみる。」)
    label?: string;
    // 飾りの大きな英字(読み上げない)
    decorative?: boolean;
    children: ReactNode;
};

export function Reveal({ as = "h2", className, id, label, decorative, children }: Props) {
    const n = count(children);
    const state = { i: 0, step: n > 1 ? Math.min(STEP, MAX_START / (n - 1)) : 0 };
    const chars = split(children, state);
    return createElement(
        as,
        // data-rv はスクリプトが "in" に書き換えるので、ずれの警告を出さない
        { className, id, "data-rv": "", "aria-hidden": decorative || undefined, suppressHydrationWarning: true },
        decorative ? (
            chars
        ) : (
            <>
                <span className="sr-only">{label ?? text(children)}</span>
                <span aria-hidden="true">{chars}</span>
            </>
        ),
    );
}

// GridShell の先頭に置くスクリプト。見出しより先に動いて <html> に rv を付けるので、見えてから隠れることがない
// - 動きを減らす設定・フッターの「動きを止める」・IntersectionObserver がないときは、何もしない(最初から見えている)
// - 少し画面に入ってから(下から 8% の内側)、1 回だけ data-rv="in" にする
// - ページを移ったあと(クライアントの移動)は、RevealWatch が window.__senriReveal() を呼んで、新しい見出しを見張る
export const REVEAL_SCRIPT = `(function(){try{var d=document.documentElement;if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;try{if(localStorage.getItem("senri.motion")==="off")return}catch(e){}if(!("IntersectionObserver" in window))return;var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.setAttribute("data-rv","in");io.unobserve(e.target)}})},{rootMargin:"0px 0px -8% 0px"});var go=function(){document.querySelectorAll("[data-rv]:not([data-rv=in])").forEach(function(el){io.observe(el)})};window.__senriReveal=go;d.classList.add("rv");if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go()}catch(e){document.documentElement.classList.remove("rv")}})();`;
