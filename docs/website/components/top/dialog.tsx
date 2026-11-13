"use client";
// 押したもの(マスやボタン)の位置から広がるダイアログ(docs/design/GridFull.dc.html の .dlg)
// - role="dialog" と aria-modal。開いたら × にフォーカスし、Tab は中で回す
// - 背景のクリック・×・Esc で閉じる。閉じたら、開いたものにフォーカスを戻す
// - 開いている間は、後ろのページをスクロールさせない
// - .g の外(body の直下)に出すので、色の変数のために .g を付けた箱に入れる
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Origin = { rect: DOMRect; opener: HTMLElement };

export function originOf(el: HTMLElement): Origin {
    return { rect: el.getBoundingClientRect(), opener: el };
}

// マスの真ん中から、画面の真ん中までのずれと、大きさの比
function offsetFrom(rect: DOMRect): React.CSSProperties {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dw = Math.min(1040, vw * 0.92);
    return {
        "--fx": `${Math.round(rect.left + rect.width / 2 - vw / 2)}px`,
        "--fy": `${Math.round(rect.top + rect.height / 2 - vh / 2)}px`,
        "--fs": Math.max(0.2, Math.min(1, rect.width / dw)).toFixed(3),
    } as React.CSSProperties;
}

export function Dialog({
    origin,
    labelledBy,
    closeLabel,
    onClose,
    children,
}: {
    origin: Origin;
    labelledBy: string;
    closeLabel: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    // 最初に描くときから、開いた位置を入れておく(アニメーションの最初のコマで使う)
    const [style] = useState(() => offsetFrom(origin.rect));
    // onClose が描くたびに作り直されても、開いたときの処理をやり直さない
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useLayoutEffect(() => {
        close.current?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        const opener = origin.opener;
        const html = document.documentElement;
        const before = html.style.overflow;
        html.style.overflow = "hidden";
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onCloseRef.current();
                return;
            }
            if (e.key !== "Tab" || !ref.current) return;
            const items = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
            if (items.length === 0) return;
            const first = items[0]!;
            const last = items.at(-1)!;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            html.style.overflow = before;
            opener.focus({ preventScroll: true });
        };
    }, [origin]);

    return createPortal(
        <div className="g" style={{ minHeight: 0, display: "contents" }}>
            <div className="g-scrim" onClick={onClose} aria-hidden="true" />
            <div ref={ref} className="g-dlg" role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={style}>
                <button ref={close} type="button" className="dlgx" onClick={onClose} aria-label={closeLabel}>
                    ×
                </button>
                {children}
            </div>
        </div>,
        document.body,
    );
}
