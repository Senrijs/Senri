// 画面の言語と文言。言語はサーバーが決めて、ページのデータに入れてくる(App.vue が配る)
import { inject, type InjectionKey } from "vue";
import type { Lang } from "../../src/lang.ts";
import { message, type MessageKey, type Params } from "../../src/dev/messages.ts";

export const LANG: InjectionKey<Lang> = Symbol("lang");

export function useI18n() {
    const lang = inject(LANG, "en");
    return { lang, t: (key: MessageKey, params?: Params) => message(lang, key, params) };
}
