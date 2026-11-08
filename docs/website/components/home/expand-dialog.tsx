"use client";
// 押したカード(やボタン)の位置から広がるダイアログ。<dialog> の showModal() を使うので、
// フォーカスは中に入り、外は操作できなくなる。Esc と外側のクリックで、元の位置に縮んでから閉じる
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon } from "./icons";
import { useStill } from "./motion";

export type Origin = { rect: DOMRect; opener: HTMLElement };

type Box = { top: number; left: number; width: number; height: number };

const OPEN_MS = 180;
const CLOSE_MS = 480;

function target(): Box {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(880, vw - 32);
    const height = Math.min(560, vh - 64);
    return { top: Math.round((vh - height) / 2), left: Math.round((vw - width) / 2), width, height };
}

const boxOf = (r: DOMRect): Box => ({ top: r.top, left: r.left, width: r.width, height: r.height });

export function ExpandDialog({
    origin,
    title,
    description,
    closeLabel,
    onClosed,
    children,
}: {
    origin: Origin;
    title: string;
    description: string;
    closeLabel: string;
    onClosed: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const still = useStill();
    const [box, setBox] = useState<Box>(() => (still ? target() : boxOf(origin.rect)));
    const [lift, setLift] = useState(!still);
    const closing = useRef(false);

    useLayoutEffect(() => {
        const dialog = ref.current!;
        dialog.showModal();
        if (still) return;
        // 持ち上げてから、真ん中に広げる
        const timer = setTimeout(() => {
            setLift(false);
            setBox(target());
        }, OPEN_MS);
        return () => clearTimeout(timer);
    }, [still]);

    // 画面の大きさが変わったら、真ん中に置き直す
    useEffect(() => {
        const onResize = () => {
            if (!closing.current) setBox(target());
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    function close() {
        if (closing.current) return;
        closing.current = true;
        const finish = () => {
            ref.current?.close();
            onClosed();
            origin.opener.focus();
        };
        if (still) return finish();
        setLift(true);
        setBox(boxOf(origin.opener.getBoundingClientRect()));
        setTimeout(finish, CLOSE_MS);
    }

    return (
        <dialog
            ref={ref}
            className={lift ? "s-dialog lift" : "s-dialog"}
            aria-labelledby="s-dialog-title"
            aria-describedby="s-dialog-desc"
            style={box}
            onCancel={(e) => {
                e.preventDefault();
                close();
            }}
            onClick={(e) => {
                // 外側(::backdrop)を押したとき
                if (e.target === e.currentTarget) {
                    const r = e.currentTarget.getBoundingClientRect();
                    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
                }
            }}
        >
            <div className="head">
                <div>
                    <h2 id="s-dialog-title" className="title">
                        {title}
                    </h2>
                    <p id="s-dialog-desc" className="desc">
                        {description}
                    </p>
                </div>
                <button type="button" className="x" onClick={close} aria-label={closeLabel} autoFocus>
                    <CloseIcon size={16} />
                </button>
            </div>
            <div className="body">{children}</div>
        </dialog>
    );
}

// ヒントの `...` をコードとして出す(Senri の開発用ページと同じ書き方)
export function RichText({ text }: { text: string }) {
    return (
        <>
            {text.split(/(`[^`]+`)/).map((part, i) =>
                part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
            )}
        </>
    );
}
