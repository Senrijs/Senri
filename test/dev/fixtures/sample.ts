import { createApp } from "@senrijs/senri";

const app = createApp();

app.get("/boom", () => {
    throw new Error("わざと壊した");
});

app.get("/ok", () => "ok");

export default app;
export const pick = (x: { a?: { b: number } }) => { if (!x) throw new Error("no"); return x.a!.b; };
