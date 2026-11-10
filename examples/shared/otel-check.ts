// otel() がどのランタイムでも同じに動くかを、smoke で確かめるためのもの
// 本物の @opentelemetry/api の代わりに、span の名前と親だけを記録する小さなものを渡す
// (本物の SDK とのつながりは test/otel.test.ts と test/node/otel.test.ts で確かめている)
import type { OtelApi, OtelSpan } from "../../src/otel.ts";

type Recorded = { name: string; parent: string; status: number };
type FakeContext = { span?: Recorded; remote?: string };

export const recorded: Recorded[] = [];

export const fakeApi: OtelApi = {
    trace: {
        getTracer: () => ({
            startSpan(name, options, context) {
                const ctx = (context ?? {}) as FakeContext;
                const record: Recorded = { name, parent: ctx.span?.name ?? ctx.remote ?? "root", status: 0 };
                const span: OtelSpan & { record: Recorded } = {
                    record,
                    setAttribute: (key, value) => {
                        if (key === "http.response.status_code") record.status = Number(value);
                    },
                    setStatus: () => {},
                    recordException: () => {},
                    updateName: () => {},
                    end: () => void recorded.push(record),
                };
                return span;
            },
        }),
        setSpan: (_context, span) => ({ span: (span as OtelSpan & { record: Recorded }).record }) satisfies FakeContext,
    },
    context: {
        active: () => ({}),
        with: (_context, fn) => fn(),
    },
    propagation: {
        extract: (_context, carrier, getter) => {
            const traceparent = getter?.get(carrier, "traceparent");
            return (typeof traceparent === "string" ? { remote: `remote ${traceparent.split("-")[2]}` } : {}) satisfies FakeContext;
        },
    },
};
