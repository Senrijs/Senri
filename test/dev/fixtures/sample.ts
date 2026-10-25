import { createApp } from "senri";

const app = createApp();

app.get("/boom", () => {
    throw new Error("わざと壊した");
});

app.get("/ok", () => "ok");

export default app;
