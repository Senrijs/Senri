// セルフヒールのデモ: bun examples/bun/self-heal.ts
// /search をカオスで壊し続けると 🔴(止める)になり、壊すのをやめると、少し待ってから勝手に 🟢 に戻る
// 横の /weather は、その間もずっと 200 を返す。http://localhost:3927/_senri のルートのタブでも状態が見える
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";
import { chaos } from "../../src/chaos.ts";
import { selfHeal } from "../../src/self-heal.ts";
import { serve } from "../../adapters/serve/index.ts";

const app = createApp({ dev: devtools() });
// デモなので、短い時間で止めて戻す
app.use(selfHeal({ window: "10s", minRequests: 5, cooldown: "5s" }));
// ランダムには壊さない(X-Senri-Chaos ヘッダーを付けたリクエストだけ壊す)
app.use(chaos({ enabled: true, seed: 1 }));
app.get("/search", () => ({ hits: ["senri"] }));
app.get("/weather", () => ({ sky: "clear" }));

const server = await serve(app);

// 最初の 4 秒は /search を 503 で壊し、そのあとは普通に叩く。20 秒で終わる
const start = Date.now();
const mark = (status: number) => (status === 200 ? "🟢" : "🔴");
const timer = setInterval(async () => {
    const elapsed = Date.now() - start;
    const breaking = elapsed < 4000;
    const search = await fetch(`${server.url}/search`, { headers: breaking ? { "X-Senri-Chaos": "status=503" } : {} });
    const weather = await fetch(`${server.url}/weather`);
    const retry = search.headers.get("retry-after");
    console.log(
        `${(elapsed / 1000).toFixed(1).padStart(4)}s  /search ${mark(search.status)} ${search.status}${retry ? ` (Retry-After: ${retry})` : ""}${breaking ? "  ← chaos" : ""}   /weather ${mark(weather.status)} ${weather.status}`,
    );
    if (elapsed > 20_000) {
        clearInterval(timer);
        await server.stop();
    }
}, 500);
