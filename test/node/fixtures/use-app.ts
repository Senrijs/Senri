// 子プロセスで動かすアプリ: node --import ./record-modules.ts use-app.ts <dev|prod> <src|dist>
// いろいろなリクエスト(成功・404・405・500・ブラウザからの 500・/_senri)を処理してから終わる
const [mode, from] = process.argv.slice(2);
const entry = from === "dist" ? "../../../dist/src/index.js" : "../../../src/index.ts";
const { createApp, HttpError } = (await import(entry)) as typeof import("../../../src/index.ts");

const app = createApp({ dev: mode === "dev" });
app.use(async (_c, next) => next());
app.get("/", () => "hi");
app.get("/users/:id", ({ id }) => ({ id }));
app.get("/boom", () => {
    throw new Error("boom");
});
app.get("/teapot", () => {
    throw new HttpError(418, "teapot");
});

const html = { accept: "text/html" };
for (const [path, init] of [
    ["/", {}],
    ["/users/1", {}],
    ["/nope", {}],
    ["/nope", { headers: html }],
    ["/", { method: "DELETE" }],
    ["/boom", {}],
    ["/boom", { headers: html }],
    ["/teapot", {}],
    ["/_senri", {}],
] as const) {
    const res = await app.fetch(new Request(`http://localhost${path}`, init));
    await res.text();
}
// 500 のときに出るログは、ここでは見ない
console.error = () => {};
