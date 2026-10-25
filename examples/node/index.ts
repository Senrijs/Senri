import { app } from "../shared/app.ts";
import { serve } from "../../adapters/serve/index.ts";

// ポートは serve() が決める: serve(app, { port }) で明示 → 環境変数 PORT → 3927
serve(app);
