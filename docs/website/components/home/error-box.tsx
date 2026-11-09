// 開発中のエラー画面の見本。中身は、本物の Senri で動かしたときのエラーとヒント(lib/home/generated.json)
import type { Recording } from "@/lib/home/types";
import { RichText } from "./expand-dialog";

// status: 見出しの左に出すもの(ふつうは 500。コードを動かす前の間違いでは、別の言葉を渡す)
export function ErrorBox({ error, code, file, big, status = "500" }: { error: NonNullable<Recording["error"]>; code: string; file: string; big?: boolean; status?: string }) {
    const lines = code.split("\n");
    const hit = error.line;
    const from = hit ? Math.max(1, hit - 2) : 0;
    const to = hit ? Math.min(lines.length, hit + 2) : -1;
    const frame = [];
    for (let n = from; n >= 1 && n <= to; n++) frame.push({ n, text: lines[n - 1]!, hit: n === hit });
    const width = String(to).length;

    return (
        <div className="s-errbox">
            <div className={big ? "top big" : "top"}>
                <small>
                    {status} · {file}
                    {hit ? `:${hit}` : ""}
                </small>
                {error.name}: {error.message}
            </div>
            {frame.length > 0 ? (
                <div className="frame">
                    {frame.map((l) => (
                        <div key={l.n} className={l.hit ? "hit" : undefined}>
                            {String(l.n).padStart(width, " ")}  {l.text}
                        </div>
                    ))}
                </div>
            ) : null}
            {error.hint ? (
                <div className="help">
                    <RichText text={error.hint} />
                    {error.hintCode ? <code className="fix">{error.hintCode}</code> : null}
                </div>
            ) : null}
        </div>
    );
}
