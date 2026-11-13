"use client";
// クライアントの移動(ブログ → トップなど)で新しく出た見出しも、浮かび上がらせる
// 最初の読み込みは REVEAL_SCRIPT が見張る。スクリプトが動いていない(<html> に rv がない)ときは何もしない
import { usePathname } from "next/navigation";
import { useEffect } from "react";

declare global {
    interface Window {
        __senriReveal?: () => void;
    }
}

export function RevealWatch() {
    const path = usePathname();
    useEffect(() => {
        window.__senriReveal?.();
    }, [path]);
    return null;
}
