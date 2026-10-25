// サーバー(簡易表示)とブラウザ(Vue の画面)の両方で使う文言
import type { ConversionOrigin } from "../errors.ts";

// 返した値をレスポンスにできなかったときの説明(エラーの場所の代わりに出す)
export function originText(origin: ConversionOrigin): string {
    // ミドルウェア名は英数字なので、「が」との間に空白を入れて読みやすくする
    const who = origin.kind === "handler" ? `${origin.name} のハンドラー` : `ミドルウェア ${origin.name} `;
    return `${who}が返した値を、レスポンスにできませんでした`;
}
