import { showRoutes } from "../../src/index.ts";
import { app } from "../shared/app.ts";

Bun.serve({ port: 3000, fetch: app.fetch });
showRoutes(app, "http://localhost:3000");