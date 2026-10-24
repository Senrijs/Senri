import { app } from "../shared/app.ts";

Deno.serve({ port: 3000 }, app.fetch);