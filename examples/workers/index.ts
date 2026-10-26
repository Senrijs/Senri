import { app } from "../shared/app.ts";

// Cloudflare Workers はアプリをそのまま default export する(app.fetch(req, env, ctx) が呼ばれる)
// c.env と c.executionCtx を確かめるためのルートだけ、ここで足す
app.get("/env", (_, c) => (c.env as { GREETING: string }).GREETING);
app.get("/wait-until", (_, c) => {
    c.executionCtx.waitUntil(Promise.resolve());
    return "ok";
});

export default app;
