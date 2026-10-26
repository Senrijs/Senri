import { describe, expect, test } from "bun:test";
import {
    applyEvent,
    describeRequest,
    filterRequests,
    formatAverage,
    formatTime,
    latestOnly,
    middlewareScope,
    routeChain,
    statusClass,
    timeline,
} from "../../ui/src/dashboard.ts";
import type { RequestSummary } from "../../src/dev/page-data.ts";
import type { DashboardRecord, RecordLayer } from "../../src/dev/dashboard/record.ts";

const summary = (id: string, status: number, path = "/x"): RequestSummary => ({
    id,
    time: 0,
    method: "GET",
    path,
    status,
    durationMs: 1,
    hasError: status >= 500,
});

const layer = (name: string, depth: number, start: number, total: number, self: number, state: RecordLayer["state"] = "ok"): RecordLayer => ({
    name,
    depth,
    start,
    total,
    self,
    state,
});

const record = (layers: RecordLayer[], status = 200, durationMs = 10): DashboardRecord => ({
    id: "1",
    time: 0,
    method: "GET",
    path: "/x",
    query: "",
    route: "/x",
    params: {},
    status,
    durationMs,
    layers,
    requestHeaders: [],
    responseHeaders: [],
    error: null,
});

describe("一覧の絞り込み", () => {
    const list = [summary("1", 200, "/users/1"), summary("2", 404, "/nope"), summary("3", 500, "/boom"), summary("4", 201, "/users")];

    test("ステータスの百の位で絞る", () => {
        expect(filterRequests(list, "", "all").map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
        expect(filterRequests(list, "", "2").map((r) => r.id)).toEqual(["1", "4"]);
        expect(filterRequests(list, "", "4").map((r) => r.id)).toEqual(["2"]);
        expect(filterRequests(list, "", "5").map((r) => r.id)).toEqual(["3"]);
    });

    test("パスの文字でも絞れる(ステータスと組み合わせられる)", () => {
        expect(filterRequests(list, "users", "all").map((r) => r.id)).toEqual(["1", "4"]);
        expect(filterRequests(list, "USERS", "2").map((r) => r.id)).toEqual(["1", "4"]);
    });

    test("ステータスの色分け", () => {
        expect([200, 302, 404, 500].map(statusClass)).toEqual(["ok", "redirect", "warn", "error"]);
    });

    test("時刻は HH:MM:SS.mmm(この PC の時刻で)", () => {
        const t = new Date(2026, 9, 25, 20, 4, 12, 481).getTime();
        expect(formatTime(t)).toBe("20:04:12.481");
    });
});

describe("SSE のイベントを一覧に反映する", () => {
    test("新しいものを先頭に足し、上限を超えたら末尾(古いもの)を捨てる", () => {
        let list = [summary("2", 200), summary("1", 200)];
        list = applyEvent(list, { type: "request", item: summary("3", 200) }, 3);
        expect(list.map((r) => r.id)).toEqual(["3", "2", "1"]);
        list = applyEvent(list, { type: "request", item: summary("4", 200) }, 3);
        expect(list.map((r) => r.id)).toEqual(["4", "3", "2"]);
    });

    test("同じ id が二重に届いても1件だけ(再接続で取り直したときなど)", () => {
        const list = applyEvent([summary("1", 200)], { type: "request", item: summary("1", 200) }, 10);
        expect(list).toHaveLength(1);
    });

    test("クリアで空になる", () => {
        expect(applyEvent([summary("1", 200)], { type: "clear" }, 10)).toEqual([]);
    });
});

describe("玉ねぎタイムライン", () => {
    test("棒の位置(開始)と幅(下流込みの時間)を、リクエスト全体に対する割合で置く", () => {
        const bars = timeline(record([layer("logger", 0, 0, 10, 1), layer("handler", 1, 2, 5, 5)], 200, 10));

        expect(bars[0]).toMatchObject({ name: "logger", indent: 0, left: 0, width: 100, selfWidth: 10, state: "ok" });
        expect(bars[0]!.label).toBe("self 1.0 / 10.0ms");
        expect(bars[1]).toMatchObject({ name: "handler", indent: 1, left: 20, width: 50, selfWidth: 100 });
    });

    test("ここで終了・例外・未到達の書き分け", () => {
        const bars = timeline(
            record(
                [layer("logger", 0, 0, 2, 0.5), layer("auth", 1, 0.5, 1, 1, "stopped"), layer("handler", 2, 0, 0, 0, "skipped")],
                401,
                2,
            ),
        );

        expect(bars.map((b) => b.label)).toEqual(["self 0.5 / 2.0ms", "1.0ms ← ここで終了", "未到達"]);
        expect(timeline(record([layer("handler", 0, 0, 3, 3, "failed")], 500, 3))[0]!.label).toBe("3.0ms ✕ 例外");
    });

    test("全体が 0ms でも 0 で割らない", () => {
        const [bar] = timeline(record([layer("handler", 0, 0, 0, 0)], 200, 0));
        expect(bar).toMatchObject({ left: 0, width: 100, selfWidth: 100 });
    });
});

describe("latestOnly: 最後に始めた取得の結果だけを使う", () => {
    test("A を取りに行っている間に B を選んだら、A の結果は捨てる", () => {
        const latest = latestOnly();

        const a = latest.start();
        const b = latest.start();

        expect(a()).toBe(false);
        expect(b()).toBe(true);
    });

    test("クリアなどで選択がなくなったときも、取得中のものは捨てる", () => {
        const latest = latestOnly();
        const b = latest.start();

        latest.start();

        expect(b()).toBe(false);
    });
});

describe("ルートのタブ", () => {
    test("通るミドルウェアを順に並べ、最後に handler。かからないものは省き、パスによるものは印を付ける", () => {
        const chain = routeChain({
            method: "GET",
            path: "/:page",
            middlewares: [
                { name: "logger", applies: "yes" },
                { name: "auth", applies: "maybe" },
                { name: "cache", applies: "no" },
            ],
        });

        expect(chain).toEqual([
            { name: "logger", maybe: false },
            { name: "auth", maybe: true },
            { name: "handler", maybe: false },
        ]);
    });
});

describe("ミドルウェアのタブ", () => {
    test("かかる範囲の言い方", () => {
        expect(middlewareScope(null)).toBe("すべてのパス");
        expect(middlewareScope("/admin")).toBe("/admin とその下");
    });

    test("平均時間(まだ通っていなければ —)", () => {
        expect(formatAverage({ order: 1, name: "logger", path: null, runs: 3, avgSelfMs: 0.25 })).toBe("平均 0.3ms(3件)");
        expect(formatAverage({ order: 2, name: "auth", path: "/admin", runs: 0, avgSelfMs: null })).toBe("—");
    });
});

describe("説明文", () => {
    test("next() を呼ばずに返して止まった", () => {
        const r = record([layer("logger", 0, 0, 1, 0.2), layer("auth", 1, 0.2, 0.4, 0.4, "stopped"), layer("handler", 2, 0, 0, 0, "skipped")], 401, 1);
        expect(describeRequest(r)).toBe("auth が next() を呼ばずに 401 を返したので、handler には届いていません。");
    });

    test("例外が起きた", () => {
        const r = record([layer("logger", 0, 0, 2, 0.2), layer("handler", 1, 0.2, 1.6, 1.6, "failed")], 500, 2);
        expect(describeRequest(r)).toBe("handler で例外が起きて、onError が 500 を返しました。");
    });

    test("一致するルートがなかった", () => {
        const r = record([layer("logger", 0, 0, 1, 0.5), layer("notFound", 1, 0.5, 0.5, 0.5)], 404, 1);
        expect(describeRequest(r)).toBe("一致するルートがないので notFound が動きました。");
    });

    test("時間の大半を使った層", () => {
        const r = record([layer("logger", 0, 0, 10, 0.4), layer("handler", 1, 0.4, 9.6, 9.6)], 200, 10);
        expect(describeRequest(r)).toBe("ほとんどの時間(96%)は handler で使われています。");
    });

    test("とくに言うことがなければ空", () => {
        const r = record([layer("logger", 0, 0, 1, 0.5), layer("handler", 1, 0.5, 0.5, 0.5)], 200, 1);
        expect(describeRequest(r)).toBe("");
    });
});
