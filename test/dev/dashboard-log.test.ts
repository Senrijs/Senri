import { describe, expect, test } from "bun:test";
import { RequestLog } from "../../src/dev/dashboard/log.ts";
import { maskHeaders } from "../../src/dev/dashboard/mask.ts";

const item = (id: number) => ({ id: String(id) });

describe("RequestLog: 直近の記録だけを持つ", () => {
    test("上限(既定 200 件)を超えたら古いものから捨てる", () => {
        const log = new RequestLog();
        for (let i = 1; i <= 205; i++) log.add(item(i));

        expect(log.size).toBe(200);
        // 新しい順に並ぶ
        expect(log.list()[0]!.id).toBe("205");
        expect(log.list().at(-1)!.id).toBe("6");
        expect(log.get("5")).toBeUndefined();
        expect(log.get("6")).toEqual(item(6));
    });

    test("上限は変えられる", () => {
        const log = new RequestLog(3);
        for (let i = 1; i <= 5; i++) log.add(item(i));

        expect(log.list().map((x) => x.id)).toEqual(["5", "4", "3"]);
    });

    test("購読すると、追加とクリアが届く。解除すると届かない", () => {
        const log = new RequestLog();
        const events: unknown[] = [];
        const unsubscribe = log.subscribe((e) => events.push(e));

        log.add(item(1));
        log.clear();
        unsubscribe();
        log.add(item(2));

        expect(events).toEqual([{ type: "request", item: item(1) }, { type: "clear" }]);
        expect(log.listenerCount).toBe(0);
        expect(log.list()).toEqual([item(2)]);
    });

    test("購読している側が例外を投げても、記録とほかの購読者は止まらない", () => {
        const log = new RequestLog();
        const got: unknown[] = [];
        log.subscribe(() => {
            throw new Error("壊れた購読者");
        });
        log.subscribe((e) => got.push(e));

        expect(() => log.add(item(1))).not.toThrow();
        expect(got).toHaveLength(1);
        expect(log.size).toBe(1);
    });
});

describe("maskHeaders: 機密ヘッダーを *** に伏せる", () => {
    test("認証・Cookie 系は伏せる(大文字小文字は区別しない)", () => {
        const headers = new Headers({
            Authorization: "Bearer abc",
            "Proxy-Authorization": "Basic xyz",
            Cookie: "session=1",
            "X-API-Key": "k",
            "X-Auth-Token": "t",
            "X-Session-Id": "s",
            "X-My-Secret": "s",
            "X-Db-Password": "p",
            Accept: "text/html",
            "User-Agent": "test",
        });

        expect(maskHeaders(headers)).toEqual([
            ["accept", "text/html"],
            ["authorization", "***"],
            ["cookie", "***"],
            ["proxy-authorization", "***"],
            ["user-agent", "test"],
            ["x-api-key", "***"],
            ["x-auth-token", "***"],
            ["x-db-password", "***"],
            ["x-my-secret", "***"],
            ["x-session-id", "***"],
        ]);
    });

    test("Set-Cookie は1つずつ伏せる(何個付いたかは分かる)", () => {
        const headers = new Headers();
        headers.append("set-cookie", "a=1");
        headers.append("set-cookie", "b=2");
        headers.set("content-type", "text/plain");

        expect(maskHeaders(headers)).toEqual([
            ["content-type", "text/plain"],
            ["set-cookie", "***"],
            ["set-cookie", "***"],
        ]);
    });
});
