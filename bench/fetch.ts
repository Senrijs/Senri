// アプリの fetch をプロセスの中で直接呼ぶベンチマーク(ネットワークなし)
// ルーターだけでなく、Request を受けて Response を返すまでの処理全体を比べる
// 使い方: cd bench && bun install && bun run fetch
import { bench, group, run, summary } from "mitata";
import { APPS, REQUESTS } from "./apps.ts";

const apps = APPS.map((make) => make());

// 先に全部のアプリで同じ答えになるか確かめる(ベンチマークの前提)
for (const [name, method, path] of REQUESTS) {
    const statuses = await Promise.all(
        apps.map(async (app) => (await app.fetch(new Request(`http://localhost${path}`, { method }))).status),
    );
    if (new Set(statuses).size !== 1) throw new Error(`${name}: status が揃っていない ${statuses.join(", ")}`);
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
