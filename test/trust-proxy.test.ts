import { describe, expect, test } from "bun:test";
import { createApp } from "../src/index.ts";
import { getIp, trustProxy, type TrustProxyOptions } from "../src/ip.ts";
import { explainText } from "../src/dev/explain.ts";
import { inRange, normalizeIp, parseIp, parseRange } from "../src/ip-address.ts";
import { bundleOf } from "./bundle.ts";

async function ipOf(options: TrustProxyOptions, peer: string | null, headers: Record<string, string> = {}): Promise<string> {
    const clientIp = trustProxy(options);
    const app = createApp();
    app.get("/", (_, c) => clientIp(c) ?? "null");
    const info = peer === null ? undefined : { remoteAddr: { hostname: peer } };
    return (await app.fetch(new Request("http://localhost/", { headers }), info)).text();
}

describe("parseIp()", () => {
    test("IPv4", () => {
        expect(parseIp("192.0.2.1")).toEqual(new Uint8Array([192, 0, 2, 1]));
        expect(parseIp("0.0.0.0")).toEqual(new Uint8Array(4));
    });

    test("IPv6", () => {
        const loopback = new Uint8Array(16);
        loopback[15] = 1;
        expect(parseIp("::1")).toEqual(loopback);
        expect(parseIp("0:0:0:0:0:0:0:1")).toEqual(loopback);
        expect(parseIp("2001:DB8::1")).toEqual(parseIp("2001:db8:0:0:0:0:0:1"));
        expect(parseIp("::")).toEqual(new Uint8Array(16));
        expect(parseIp("1::")?.[1]).toBe(1);
    });

    test("IPv4 を IPv6 の形で書いたものは IPv4 にする", () => {
        const v4 = new Uint8Array([192, 0, 2, 1]);
        expect(parseIp("::ffff:192.0.2.1")).toEqual(v4);
        expect(parseIp("::FFFF:c000:0201")).toEqual(v4);
        expect(parseIp("0:0:0:0:0:ffff:192.0.2.1")).toEqual(v4);
    });

    test("ゾーンは無視する", () => {
        expect(parseIp("fe80::1%eth0")).toEqual(parseIp("fe80::1"));
    });

    test.each([
        "",
        "abc",
        "unknown",
        "1.2.3",
        "1.2.3.4.5",
        "256.0.0.1",
        "01.2.3.4",
        "1.2.3.-4",
        "1.2.3.4 ",
        " 1.2.3.4",
        "1.2.3.4:80",
        "1.2.3.4\r\nX: y",
        ":::",
        "1::2::3",
        "1:2:3:4:5:6:7",
        "1:2:3:4:5:6:7:8:9",
        "1:2:3:4:5:6:7::8",
        "12345::",
        "g::",
        "::1.2.3",
        "[::1]",
    ])("読めない: %j", (text) => {
        expect(parseIp(text)).toBeNull();
    });
});

describe("normalizeIp()", () => {
    test("読めるものだけを、そろえて返す", () => {
        expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
        expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
        expect(normalizeIp("fe80::1%eth0\r\nX: y")).toBe("fe80::1");
        expect(normalizeIp("evil")).toBeNull();
    });
});

describe("parseRange() と inRange()", () => {
    const within = (ip: string, range: string) => inRange(parseIp(ip)!, parseRange(range)!);

    test("IPv4", () => {
        expect(within("10.1.2.3", "10.0.0.0/8")).toBe(true);
        expect(within("11.1.2.3", "10.0.0.0/8")).toBe(false);
        expect(within("192.168.1.127", "192.168.1.0/25")).toBe(true);
        expect(within("192.168.1.128", "192.168.1.0/25")).toBe(false);
        expect(within("1.2.3.4", "0.0.0.0/0")).toBe(true);
        expect(within("1.2.3.4", "1.2.3.4")).toBe(true);
        expect(within("1.2.3.5", "1.2.3.4")).toBe(false);
    });

    test("IPv6", () => {
        expect(within("2001:db8:1::1", "2001:db8::/32")).toBe(true);
        expect(within("2001:db9::1", "2001:db8::/32")).toBe(false);
        expect(within("2001:db8::1", "::/0")).toBe(true);
        expect(within("2001:db8::8000:0:0:0", "2001:db8::/65")).toBe(false);
    });

    test("IPv4 と IPv6 は別のもの。射影アドレスは IPv4 として比べる", () => {
        expect(within("1.2.3.4", "::/0")).toBe(false);
        expect(within("::1", "0.0.0.0/0")).toBe(false);
        expect(within("::ffff:10.0.0.1", "10.0.0.0/8")).toBe(true);
    });

    test.each(["", "abc", "10.0.0.0/33", "::/129", "10.0.0.0/-1", "10.0.0.0/a", "10.0.0.0/8/8", "10.0.0.0/", "10.0.0/8"])("読めない: %j", (text) => {
        expect(parseRange(text)).toBeNull();
    });
});

describe("trustProxy({ hops })", () => {
    const XFF = "x-forwarded-for";

    test("右から数える。先頭は信じない", async () => {
        const headers = { [XFF]: "6.6.6.6, 1.1.1.1, 2.2.2.2" };

        expect(await ipOf({ hops: 1 }, "10.0.0.1", headers)).toBe("2.2.2.2");
        expect(await ipOf({ hops: 2 }, "10.0.0.1", headers)).toBe("1.1.1.1");
        expect(await ipOf({ hops: 3 }, "10.0.0.1", headers)).toBe("6.6.6.6");
    });

    test("数より短ければ、残っている左端", async () => {
        expect(await ipOf({ hops: 2 }, "10.0.0.1", { [XFF]: "2.2.2.2" })).toBe("2.2.2.2");
    });

    test("ヘッダーがなければ、接続元", async () => {
        expect(await ipOf({ hops: 1 }, "10.0.0.1")).toBe("10.0.0.1");
        expect(await ipOf({ hops: 1 }, null)).toBe("null");
    });

    test("IP として読めない値なら null", async () => {
        for (const value of ["evil", "1.1.1.1, evil", "<script>", "1.1.1.1, ", "1.1.1.1:80"]) {
            expect(await ipOf({ hops: 1 }, "10.0.0.1", { [XFF]: value })).toBe("null");
        }
    });

    test("そろえて返す", async () => {
        expect(await ipOf({ hops: 1 }, "10.0.0.1", { [XFF]: "::ffff:1.2.3.4" })).toBe("1.2.3.4");
        expect(await ipOf({ hops: 1 }, "10.0.0.1", { [XFF]: "2001:DB8::1" })).toBe("2001:db8::1");
    });

    test("ヘッダーが2つあっても、右から数える", async () => {
        const headers = new Headers();
        headers.append(XFF, "6.6.6.6");
        headers.append(XFF, "2.2.2.2");
        const clientIp = trustProxy({ hops: 1 });
        const app = createApp();
        app.get("/", (_, c) => clientIp(c) ?? "null");

        expect(await (await app.fetch(new Request("http://localhost/", { headers }))).text()).toBe("2.2.2.2");
    });
});

describe("trustProxy({ proxies })", () => {
    const proxies = ["10.0.0.0/8", "2001:db8::/32"];
    const XFF = "x-forwarded-for";

    test("信頼するプロキシから来ていなければ、ヘッダーを読まない", async () => {
        expect(await ipOf({ proxies }, "203.0.113.9", { [XFF]: "6.6.6.6" })).toBe("203.0.113.9");
        expect(await ipOf({ proxies }, null, { [XFF]: "6.6.6.6" })).toBe("null");
    });

    test("右から見て、信頼するプロキシでない最初の値", async () => {
        expect(await ipOf({ proxies }, "10.0.0.1", { [XFF]: "6.6.6.6, 1.1.1.1, 10.0.0.2, 10.0.0.3" })).toBe("1.1.1.1");
        expect(await ipOf({ proxies }, "2001:db8::9", { [XFF]: "1.1.1.1" })).toBe("1.1.1.1");
    });

    test("全部プロキシなら、左端", async () => {
        expect(await ipOf({ proxies }, "10.0.0.1", { [XFF]: "10.0.0.2, 10.0.0.3" })).toBe("10.0.0.2");
    });

    test("ヘッダーがなければ、接続元", async () => {
        expect(await ipOf({ proxies }, "10.0.0.1")).toBe("10.0.0.1");
    });

    test("途中に読めない値があれば null", async () => {
        expect(await ipOf({ proxies }, "10.0.0.1", { [XFF]: "1.1.1.1, evil, 10.0.0.2" })).toBe("null");
    });

    test("接続元が射影アドレスでも比べられる", async () => {
        expect(await ipOf({ proxies }, "::ffff:10.0.0.1", { [XFF]: "1.1.1.1" })).toBe("1.1.1.1");
    });
});

describe("trustProxy({ header })", () => {
    test("Forwarded: for= を読む。ポートと角かっこを取る", async () => {
        const options: TrustProxyOptions = { hops: 1, header: "Forwarded" };

        expect(await ipOf(options, "10.0.0.1", { forwarded: "for=6.6.6.6, for=1.1.1.1;proto=https" })).toBe("1.1.1.1");
        expect(await ipOf(options, "10.0.0.1", { forwarded: 'by=10.0.0.1; for="[2001:db8::1]:4711"' })).toBe("2001:db8::1");
        expect(await ipOf(options, "10.0.0.1", { forwarded: 'FOR="1.1.1.1:80"' })).toBe("1.1.1.1");
    });

    test("Forwarded: 読めないものは null", async () => {
        const options: TrustProxyOptions = { hops: 1, header: "forwarded" };

        for (const value of ["for=unknown", "for=_hidden", "proto=https", "for=", "for=6.6.6.6, by=10.0.0.1"]) {
            expect(await ipOf(options, "10.0.0.1", { forwarded: value })).toBe("null");
        }
    });

    test("Forwarded を選んだら、X-Forwarded-For は読まない(逆も)", async () => {
        const headers = { forwarded: "for=1.1.1.1", "x-forwarded-for": "2.2.2.2" };

        expect(await ipOf({ hops: 1, header: "forwarded" }, "10.0.0.1", headers)).toBe("1.1.1.1");
        expect(await ipOf({ hops: 1 }, "10.0.0.1", headers)).toBe("2.2.2.2");
    });

    test("値が1つのヘッダーも使える", async () => {
        const options: TrustProxyOptions = { proxies: ["10.0.0.0/8"], header: "CF-Connecting-IP" };

        expect(await ipOf(options, "10.0.0.1", { "cf-connecting-ip": "1.1.1.1" })).toBe("1.1.1.1");
        expect(await ipOf(options, "203.0.113.9", { "cf-connecting-ip": "6.6.6.6" })).toBe("203.0.113.9");
    });
});

describe("getIp() は変わらない", () => {
    test("trustProxy を作っても、ヘッダーを読まない", async () => {
        trustProxy({ hops: 1 });
        const app = createApp();
        app.get("/", (_, c) => getIp(c) ?? "null");
        const info = { remoteAddr: { hostname: "10.0.0.1" } };
        const res = await app.fetch(new Request("http://localhost/", { headers: { "x-forwarded-for": "6.6.6.6" } }), info);

        expect(await res.text()).toBe("10.0.0.1");
    });
});

describe("設定", () => {
    test.each([
        [{}],
        [{ hops: 0 }],
        [{ hops: -1 }],
        [{ hops: 1.5 }],
        [{ hops: "1" }],
        [{ proxies: [] }],
        [{ proxies: "10.0.0.0/8" }],
        [{ proxies: ["bad"] }],
        [{ proxies: ["10.0.0.0/33"] }],
        [{ hops: 1, proxies: ["10.0.0.0/8"] }],
        [{ hops: 1, header: "x bad" }],
        [{ hops: 1, header: "" }],
    ])("不正なら、作るときに投げる。開発モードの説明がある: %j", (options) => {
        let err: unknown;
        try {
            trustProxy(options as TrustProxyOptions);
        } catch (e) {
            err = e;
        }
        expect(explainText(err)).toContain("trustProxy()");
    });
});

describe("バンドル", () => {
    test("使わなければ、本体に入らない", async () => {
        const code = await bundleOf("createApp");

        expect(code.toLowerCase()).not.toContain("x-forwarded-for");
    });
});
