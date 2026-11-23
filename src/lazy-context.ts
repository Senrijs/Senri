import { Context, nodeState } from "./context.ts";
import { PlainResponse, setLazySourceOf, type LazyRequest } from "./plain.ts";
import { pathnameOf } from "./router.ts";

class LazyContext extends Context {
    #source: LazyRequest;
    #req: Request | undefined;

    static {
        setLazySourceOf((c) => (#req in c && c.#req === undefined ? c.#source : null));
    }

    constructor(source: LazyRequest, info: unknown) {
        super(undefined as never, info);
        this.#source = source;
    }

    // @ts-expect-error 親ではプロパティ。ここだけ、最初に読んだときに作る
    override get req(): Request {
        return (this.#req ??= this.#source.create());
    }

    override set req(value: Request) {
        if (#req in this) this.#req = value;
    }
}

export function lazyContext(source: LazyRequest, info: unknown): Context {
    const c = new LazyContext(source, info);
    nodeState(c, pathnameOf(source.url));
    return c;
}

export function plainOf(c: Context<any, any>, value: unknown): PlainResponse | null {
    const [status, headers] = nodeState(c);
    if (status < 200 || status > 599 || status === 204 || status === 205 || status === 304) return null;
    let body: string;
    let type: string;
    if (typeof value === "string") {
        body = value;
        type = "text/plain; charset=utf-8";
    } else if (Array.isArray(value) || (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype)) {
        body = JSON.stringify(value);
        type = "application/json";
    } else {
        return null;
    }
    return new PlainResponse(status, headers?.get("content-type") ?? type, body, headers);
}
