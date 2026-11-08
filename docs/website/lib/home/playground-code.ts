// プレイグラウンドの最初のコード。ビルドのときの記録(scripts/home-data.ts)と、ページの両方から使う
export const PLAYGROUND_CODE = `import { createApp } from "@senrijs/senri";
import { devtools } from "@senrijs/senri/dev";

const app = createApp({ dev: devtools() });

app.get("/hello", () => ({ message: "Hello, Senri!" }));

app.get("/users/:id", ({ id }) => ({ id }));

app.get("/never-gonna-give-you-up", (_, c) =>
  c.redirect("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
);

app.get("/me", (_, c) => {
  const user = c.get("user");
  return { name: user.name };
});

export default app;
`;

// 下に並べるパスのボタン
export const QUICK_PATHS = ["/hello", "/users/42", "/never-gonna-give-you-up", "/nope"] as const;

// 「わざとエラーを出す」で送るパス
export const BOOM_PATH = "/me";
