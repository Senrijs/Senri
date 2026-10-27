// 型だけのテスト。exactOptionalPropertyTypes: true のときに、ふつうの書き方が型エラーにならないこと
// (devtools() は本番では undefined を返すので、dev に undefined を渡せないと書けなくなる)
import { createApp } from "../../src/index.ts";
import { devtools } from "../../src/dev/index.ts";

const app = createApp({ dev: devtools() });
app.get("/", () => "hi");

// 明示的に undefined を渡してもよい
createApp({ dev: undefined });
createApp({});
createApp();

// 切り替えるときの書き方
const flag = Math.random() > 0.5;
createApp({ dev: flag ? devtools() : undefined });
