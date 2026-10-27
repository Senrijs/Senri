// ページで読み込むスクリプト。アプリを window.senri に置き、Playwright から app.fetch() を呼ぶ
import { createApp } from "../../src/index.ts";
import { setup } from "./app.ts";

(globalThis as { senri?: unknown }).senri = setup(createApp());
