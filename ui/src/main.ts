// 埋め込まれた JSON を読んで、エラーページか404ページかを決める
import { createApp } from "vue";
import type { PageData } from "../../src/dev/page-data.ts";
import App from "./App.vue";
import "./theme.css";

async function readData(): Promise<PageData> {
    const text = document.getElementById("senri-data")?.textContent ?? "";
    // サーバーが置き換えていない(vite で見た目を確かめているとき)はサンプルを使う
    // import.meta.env.DEV はビルドでは false になるので、サンプルはビルド結果に入らない
    // (置き場所の文字列そのものを書くと、ビルド結果に置き場所が2つできかねないので書かない)
    if (import.meta.env.DEV && text.trim().startsWith("<!--")) {
        const { sample } = await import("./sample.ts");
        return sample(new URLSearchParams(location.search).get("page"));
    }
    return JSON.parse(text) as PageData;
}

createApp(App, { data: await readData() }).mount("#app");
