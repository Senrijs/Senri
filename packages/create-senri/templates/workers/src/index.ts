import { createApp } from "@senrijs/senri";
import { devtools } from "@senrijs/senri/dev";

// devtools(): error pages and a 404 page with suggestions, only for requests to localhost (wrangler dev).
// Remove it from production builds to keep the bundle small.
const app = createApp({ dev: devtools() });

app.get("/", () => "Hello, Senri!");
app.get("/users/:id", ({ id }) => ({ id }));

// Cloudflare Workers calls app.fetch(request, env, ctx).
export default app;
