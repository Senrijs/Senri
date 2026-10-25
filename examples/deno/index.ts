import { app } from "../shared/app.ts";
import { serve } from "../../adapters/serve/index.ts";

// ポートは serve() が決める: serve(app, { port }) で明示 → 環境変数 PORT → 3927
// (Deno は --allow-env=PORT がないと PORT を読まずに 3927 を使う。deno task start には付けてある)
serve(app);
