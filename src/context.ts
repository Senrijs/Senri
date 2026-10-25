export type HandlerResult = Response | string | object;

export type Handler<P = Record<string, string>> = (
    params: P,
    c: Context,
) => HandlerResult | Promise<HandlerResult>;

export type Next = () => Promise<Response>;

export type Middleware = (
    c: Context,
    next: Next,
) => HandlerResult | void | Promise<HandlerResult | void>;

export class Context {
    req: Request;
    #status = 200;
    #headers = new Headers();
    error: unknown = undefined;

    constructor(req: Request) {
        this.req = req;
    }

    status(code: number) {
        this.#status = code;
        return this;
    }

    header(name: string, value: string) {
        this.#headers.set(name, value);
        return this;
    }

    json(data: unknown, status?: number): Response {
        this.#headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify(data), {
            status: status ?? this.#status,
            headers: this.#headers,
        });
    }

    text(body: string, status?: number): Response {
        return new Response(body, {
            status: status ?? this.#status,
            headers: this.#headers,
        });
    }

    toResponse(value: HandlerResult): Response {
        if (value instanceof Response) {
            return value;
        }
        if (typeof value === "string") {
            return this.text(value);
        }
        return this.json(value);
    }
}
