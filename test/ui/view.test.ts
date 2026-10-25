import { describe, expect, test } from "bun:test";
import {
    editorOptions,
    filterRoutes,
    methodColor,
    visibleRoutes,
    formatMs,
    inlineCode,
    layerBars,
    loadEditor,
    openLabel,
    originText,
    saveEditor,
    visibleFrames,
} from "../../ui/src/view.ts";
import type { PageFrame } from "../../src/dev/page-data.ts";

// localStorage の代わり
function fakeStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
        data,
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => {
            data[k] = v;
        },
    };
}

describe("inlineCode: ヒントの `...` をコードとして分ける", () => {
    test("バッククォートの中だけ code になる", () => {
        expect(inlineCode("意図したなら `HttpError` を使う")).toEqual([
            { text: "意図したなら ", code: false },
            { text: "HttpError", code: true },
            { text: " を使う", code: false },
        ]);
    });

    test("バッククォートがなければそのまま", () => {
        expect(inlineCode("ふつうの文")).toEqual([{ text: "ふつうの文", code: false }]);
    });
});

describe("layerBars: 通った順番のバー", () => {
    test("self の割合で幅を決め、失敗した層に印を付ける", () => {
        const bars = layerBars([
            { name: "logger", self: 0.2, total: 2, failed: false },
            { name: "auth", self: 0, total: 1.8, failed: false },
            { name: "handler", self: 1.8, total: 1.8, failed: true },
        ]);

        expect(bars).toEqual([
            { name: "logger", ms: "0.2ms", pct: 10, failed: false },
            { name: "auth", ms: "0.0ms", pct: 0, failed: false },
            { name: "handler", ms: "1.8ms ×", pct: 90, failed: true },
        ]);
    });

    test("全部 0ms でも 0 で割らない", () => {
        expect(layerBars([{ name: "a", self: 0, total: 0, failed: false }])[0]!.pct).toBe(0);
    });
});

describe("visibleFrames: スタックの表示", () => {
    const frame = (fn: string, kind: PageFrame["kind"]): PageFrame => ({
        fn,
        file: `/app/${fn}.ts`,
        display: `${fn}.ts`,
        line: 1,
        col: 1,
        kind,
    });
    const frames = [frame("handler", "user"), frame("run", "senri"), frame("step", "senri"), frame("lib", "node_modules")];

    test("ふだんは Senri 内部を隠して、件数だけ数える", () => {
        const { shown, hidden } = visibleFrames(frames, false);

        expect(shown.map((f) => f.fn)).toEqual(["handler", "lib"]);
        expect(hidden).toBe(2);
    });

    test("「Senri 内部も表示」にすると、元の順番で全部", () => {
        const { shown, hidden } = visibleFrames(frames, true);

        expect(shown.map((f) => f.fn)).toEqual(["handler", "run", "step", "lib"]);
        expect(hidden).toBe(0);
    });
});

describe("エディタの選択", () => {
    test("保存がなければ、サーバーの推測を使う", () => {
        expect(loadEditor(fakeStorage(), { id: "zed", detected: true })).toBe("zed");
    });

    test("ページで選んだものは保存され、次からはそれを使う", () => {
        const storage = fakeStorage();
        saveEditor(storage, "cursor");

        expect(loadEditor(storage, { id: "vscode", detected: true })).toBe("cursor");
    });

    test("保存された値がおかしければ、推測を使う", () => {
        expect(loadEditor(fakeStorage({ "senri.editor": "emacs" }), { id: "vscode", detected: false })).toBe("vscode");
    });

    test("localStorage が使えない(例外を投げる)環境でも動く", () => {
        const broken = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        };

        expect(loadEditor(broken, { id: "vscode", detected: false })).toBe("vscode");
        expect(() => saveEditor(broken, "zed")).not.toThrow();
    });

    test("選択肢: 推測できたものに(自動判別)、WebStorm に(実験的)", () => {
        const options = editorOptions({ id: "vscode", detected: true });

        expect(options.map((o) => o.label)).toEqual([
            "VS Code(自動判別)",
            "Cursor",
            "WebStorm(実験的)",
            "Zed",
            "コピーのみ",
        ]);
        expect(editorOptions({ id: "vscode", detected: false })[0]!.label).toBe("VS Code");
    });

    test("開くボタンの文言", () => {
        expect(openLabel("vscode")).toBe("VS Code で開く");
        expect(openLabel("webstorm")).toBe("WebStorm で開く(実験的)");
        expect(openLabel("copy")).toBeNull();
    });
});

describe("404ページのルート一覧", () => {
    const routes = [
        { method: "GET", path: "/hello", link: true },
        { method: "POST", path: "/users", link: false },
        { method: "GET", path: "/users/:id", link: false },
        { method: "DELETE", path: "/users/:id", link: false },
    ];

    test("絞り込みは、パスかメソッドに含まれるもの(大文字小文字を区別しない)", () => {
        expect(filterRoutes(routes, "/USERS").map((r) => `${r.method} ${r.path}`)).toEqual([
            "POST /users",
            "GET /users/:id",
            "DELETE /users/:id",
        ]);
        expect(filterRoutes(routes, "delete")).toHaveLength(1);
        expect(filterRoutes(routes, "  ")).toHaveLength(4);
    });

    test("絞り込んでいないときは先頭だけ出して、残りの件数を返す", () => {
        expect(visibleRoutes(routes, "", 2)).toEqual({ shown: routes.slice(0, 2), rest: 2 });
    });

    test("絞り込んでいるときは全部出す", () => {
        expect(visibleRoutes(routes, "users", 2)).toEqual({ shown: routes.slice(1), rest: 0 });
    });

    test("メソッドの色は CSS 変数で、知らないメソッドは文字色", () => {
        expect(methodColor("GET")).toBe("var(--get)");
        expect(methodColor("ALL")).toBe("var(--text)");
    });
});

describe("originText: 返した値をレスポンスにできなかったときの説明", () => {
    test("ハンドラーとミドルウェア", () => {
        expect(originText({ kind: "handler", name: "GET /big" })).toBe(
            "GET /big のハンドラーが返した値を、レスポンスにできませんでした",
        );
        expect(originText({ kind: "middleware", name: "cache" })).toBe(
            "ミドルウェア cache が返した値を、レスポンスにできませんでした",
        );
    });
});

describe("formatMs", () => {
    test("小数1桁のミリ秒", () => {
        expect(formatMs(2.149)).toBe("2.1ms");
        expect(formatMs(null)).toBeNull();
    });
});
