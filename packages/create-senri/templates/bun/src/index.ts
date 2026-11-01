import { createApp } from "@senrijs/senri";
import { devtools } from "@senrijs/senri/dev";
import { serve } from "@senrijs/senri/serve";

// devtools(): error pages, a 404 page with suggestions and the /_senri dashboard while you develop.
// It does nothing with NODE_ENV=production. Remove it from production builds to keep the bundle small.
const app = createApp({ dev: devtools() });

app.get("/", () => "Hello, Senri!");
app.get("/users/:id", ({ id }) => ({ id }));

// The port is the `port` option, then the PORT environment variable, then 3927.
serve(app);
