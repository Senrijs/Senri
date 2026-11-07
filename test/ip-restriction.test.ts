import { describe, expect, test } from "bun:test";
import { createApp, ipRestriction, type IpRestrictionOptions } from "../src/index.ts";
import { trustProxy } from "../src/ip.ts";
import { explainText } from "../src/dev/explain.ts";
import { isPlainSafe } from "../src/plain.ts";
import { bundleOf } from "./bundle.ts";

async function statusOf(options: IpRestrictionOptions, peer: string | null, headers: Record<string, string> = {}): Promise<number> {
    const app = createApp();
    app.use(ipRestriction(options));
    app.get("/", () => "ok");
    const info = peer === null ? undefined : { remoteAddr: { hostname: peer } };
    return (await app.fetch(new Request("http://localhost/", { headers }), info)).status;
}

describe("ipRestriction()", () => {
    test("allow: 一致したものだけを通す", async () => {
        const allow = ["192.0.2.0/24", "198.51.100.7", "2001:db8::/32"];

        expect(await statusOf({ allow }, "192.0.2.200")).toBe(200);
        expect(await statusOf({ allow }, "198.51.100.7")).toBe(200);
        expect(await statusOf({ allow }, "2001:db8::1")).toBe(200);
        expect(await statusOf({ allow }, "192.0.3.1")).toBe(403);
        expect(await statusOf({ allow }, "198.51.100.8")).toBe(403);
        expect(await statusOf({ allow }, "2001:db9::1")).toBe(403);
    });

    test("deny: 一致したものを拒否して、ほかは通す", async () => {
        const deny = ["192.0.2.0/24", "2001:db8::1"];

        expect(await statusOf({ deny }, "192.0.2.1")).toBe(403);
        expect(await statusOf({ deny }, "2001:db8::1")).toBe(403);
        expect(await statusOf({ deny }, "192.0.3.1")).toBe(200);
        expect(await statusOf({ deny }, "2001:db8::2")).toBe(200);
    });

    test("deny が allow より優先する", async () => {
        const options = { allow: ["192.0.2.0/24"], deny: ["192.0.2.13"] };

        expect(await statusOf(options, "192.0.2.13")).toBe(403);
        expect(await statusOf(options, "192.0.2.14")).toBe(200);
    });

    test("allow が空なら、誰も通さない", async () => {
        expect(await statusOf({ allow: [] }, "192.0.2.1")).toBe(403);
    });

    test("deny が空なら、誰でも通す", async () => {
        expect(await statusOf({ deny: [] }, "192.0.2.1")).toBe(200);
    });

    test("射影アドレスは IPv4 として比べる。書き方の違いを問わない", async () => {
        expect(await statusOf({ allow: ["192.0.2.0/24"] }, "::ffff:192.0.2.1")).toBe(200);
        expect(await statusOf({ allow: ["2001:db8::1"] }, "2001:DB8:0:0:0:0:0:1")).toBe(200);
    });

    test("IPv4 と IPv6 は別のもの", async () => {
        expect(await statusOf({ allow: ["0.0.0.0/0"] }, "2001:db8::1")).toBe(403);
        expect(await statusOf({ allow: ["::/0"] }, "192.0.2.1")).toBe(403);
    });

    test("IP が分からなければ 403(deny だけでも)", async () => {
        expect(await statusOf({ allow: ["0.0.0.0/0"] }, null)).toBe(403);
        expect(await statusOf({ deny: ["192.0.2.1"] }, null)).toBe(403);
    });

    test("allowUnknown なら、IP が分からないときだけ通す", async () => {
        expect(await statusOf({ deny: ["192.0.2.1"], allowUnknown: true }, null)).toBe(200);
        expect(await statusOf({ allow: ["192.0.2.1"], allowUnknown: true }, "192.0.2.2")).toBe(403);
    });

    test("allowUnknown は true のときだけ効く", async () => {
        expect(await statusOf({ deny: [], allowUnknown: "yes" as unknown as boolean }, null)).toBe(403);
    });

    test("ip が読めない値を返したら、分からないものとして扱う", async () => {
        expect(await statusOf({ deny: ["192.0.2.1"], ip: () => "evil" }, "192.0.2.2")).toBe(403);
    });

    test("trustProxy() の関数で、クライアントの IP を比べる", async () => {
        const options = { allow: ["1.1.1.0/24"], ip: trustProxy({ hops: 1 }) };

        expect(await statusOf(options, "10.0.0.1", { "x-forwarded-for": "6.6.6.6, 1.1.1.1" })).toBe(200);
        expect(await statusOf(options, "10.0.0.1", { "x-forwarded-for": "1.1.1.1, 6.6.6.6" })).toBe(403);
        expect(await statusOf(options, "10.0.0.1", { "x-forwarded-for": "evil" })).toBe(403);
    });

    test("ip が投げたら通さない(500)", async () => {
        const ip = () => {
            throw new Error("boom");
        };
        expect(await statusOf({ deny: [], ip }, "192.0.2.1")).toBe(500);
    });

    test("拒否はハンドラーを動かさない。onError で本文を変えられる", async () => {
        let called = false;
        const app = createApp();
        app.use(ipRestriction({ allow: [] }));
        app.onError(() => ({ error: "forbidden" }));
        app.get("/", () => {
            called = true;
            return "ok";
        });
        const res = await app.fetch(new Request("http://localhost/"), { remoteAddr: { hostname: "192.0.2.1" } });

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden" });
        expect(called).toBe(false);
    });

    test("既定の本文", async () => {
        const app = createApp();
        app.use(ipRestriction({ allow: [] }));
        app.get("/", () => "ok");

        expect(await (await app.fetch(new Request("http://localhost/"))).text()).toBe("403 Forbidden");
    });

    test("パス指定で、その下だけを守る", async () => {
        const app = createApp();
        app.use("/admin", ipRestriction({ allow: [] }));
        app.get("/admin", () => "secret");
        app.get("/public", () => "public");

        expect((await app.fetch(new Request("http://localhost/admin"))).status).toBe(403);
        expect((await app.fetch(new Request("http://localhost/public"))).status).toBe(200);
    });

    test.each([
        [{}],
        [{ allowUnknown: true }],
        [{ ip: () => "1.1.1.1" }],
    ])("allow も deny もなければ、作るときに投げる: %j", (options) => {
        let err: unknown;
        try {
            ipRestriction(options);
        } catch (e) {
            err = e;
        }
        expect(explainText(err, "ja")).toContain("allow");
    });

    test.each([
        [{ allow: ["bad"] }],
        [{ deny: ["10.0.0.0/33"] }],
        [{ allow: "10.0.0.0/8" }],
        [{ allow: [1] }],
        [{ allow: ["10.0.0.1"], deny: ["bad"] }],
    ])("読めない範囲なら、作るときに投げる: %j", (options) => {
        let err: unknown;
        try {
            ipRestriction(options as IpRestrictionOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err, "ja")).toContain("CIDR");
    });

    test("名前と印", () => {
        const middleware = ipRestriction({ allow: [] });

        expect(middleware.name).toBe("ipRestriction");
        expect(isPlainSafe(middleware)).toBe(true);
    });

    test("使わなければ、本体に入らない", async () => {
        expect(await bundleOf("createApp")).not.toContain("ipRestriction");
    });
});
