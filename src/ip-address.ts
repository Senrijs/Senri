// IP アドレスと CIDR を読む(trustProxy、ipRestriction、rateLimit が使う)

function parseV4(text: string): number[] | null {
    const parts = text.split(".");
    if (parts.length !== 4) return null;
    const bytes: number[] = [];
    for (const part of parts) {
        // 0 で始まる書き方は、8 進数と読む実装があって紛らわしいので受け付けない
        if (!/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null;
        bytes.push(Number(part));
    }
    return bytes;
}

function parseV6(text: string): number[] | null {
    let source = text;
    // 末尾が IPv4 の書き方(::ffff:192.0.2.1)なら、16 進数の2つ分に直す
    if (source.includes(".")) {
        const at = source.lastIndexOf(":");
        const v4 = parseV4(source.slice(at + 1));
        if (at === -1 || v4 === null) return null;
        source = `${source.slice(0, at + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
    }
    const sides = source.split("::");
    if (sides.length > 2) return null;
    const groupsOf = (side: string | undefined) => (side ? side.split(":") : []);
    const left = groupsOf(sides[0]);
    const right = groupsOf(sides[1]);
    const count = left.length + right.length;
    if (sides.length === 2 ? count > 7 : count !== 8) return null;
    const groups = [...left, ...new Array<string>(8 - count).fill("0"), ...right];
    const bytes: number[] = [];
    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
        const value = Number.parseInt(group, 16);
        bytes.push(value >> 8, value & 0xff);
    }
    return bytes;
}

// IP アドレスをバイト列にする(IPv4 は 4 バイト、IPv6 は 16 バイト)。読めなければ null
// IPv4 を IPv6 の形で書いたもの(::ffff:192.0.2.1)は IPv4 にそろえる。ゾーン(fe80::1%eth0)は無視する
export function parseIp(text: string): Uint8Array | null {
    const bare = text.split("%", 1)[0]!;
    const bytes = bare.includes(":") ? parseV6(bare) : parseV4(bare);
    if (bytes === null) return null;
    const mapped = bytes.length === 16 && bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
    return new Uint8Array(mapped ? bytes.slice(12) : bytes);
}

// 読める IP アドレスだけを、そろえた文字列にする。読めなければ null(ヘッダーの値をそのまま外に出さないため)
export function normalizeIp(text: string): string | null {
    const bytes = parseIp(text);
    if (bytes === null) return null;
    return bytes.length === 4 ? bytes.join(".") : text.split("%", 1)[0]!.toLowerCase();
}

export type IpRange = { bytes: Uint8Array; bits: number };

// "192.0.2.1" や "10.0.0.0/8" を読む。読めなければ null
export function parseRange(text: string): IpRange | null {
    const [address, prefix, extra] = text.split("/");
    const bytes = parseIp(address!);
    if (bytes === null || extra !== undefined) return null;
    const max = bytes.length * 8;
    if (prefix === undefined) return { bytes, bits: max };
    if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > max) return null;
    return { bytes, bits: Number(prefix) };
}

// IPv4 と IPv6 は別のものとして扱う
export function inRange(ip: Uint8Array, range: IpRange): boolean {
    if (ip.length !== range.bytes.length) return false;
    const whole = range.bits >> 3;
    for (let i = 0; i < whole; i++) {
        if (ip[i] !== range.bytes[i]) return false;
    }
    const rest = range.bits & 7;
    if (rest === 0) return true;
    const mask = (0xff << (8 - rest)) & 0xff;
    return (ip[whole]! & mask) === (range.bytes[whole]! & mask);
}
