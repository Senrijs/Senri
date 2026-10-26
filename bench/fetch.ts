// アプリの fetch をプロセスの中で直接呼ぶベンチマーク(ネットワークなし)
// ルーターだけでなく、Request を受けて Response を返すまでの処理全体を比べる
// 使い方: cd bench && bun install && bun run fetch
import { bench, group, run, summary } from "mitata";
import { APPS, checkResponse, REQUESTS } from "./apps.ts";

const apps = APPS.map((make) => make());

// 先に全部のアプリが期待どおりの status と本文を返すか確かめる(ベンチマークの前提)
for (const [name, method, path, route] of REQUESTS) {
    for (const app of apps) {
        const problem = await checkResponse(await app.fetch(new Request(`http://localhost${path}`, { method })), route);
        if (problem) throw new Error(`${name}(${app.name}): ${problem}`);
    }
}

for (const [name, method, path] of REQUESTS) {
    // Request を作るコストは共通なので、ループの外で作っておいて使い回す(ボディは持たない)
    const req = new Request(`http://localhost${path}`, { method });
    summary(() => {
        group(name, () => {
            for (const app of apps) {
                bench(app.name, async () => {
                    const res = await app.fetch(req);
                    // ボディを読むところまで含める
                    await res.text();
                });
            }
        });
    });
}

await run();
