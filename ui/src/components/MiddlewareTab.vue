<script setup lang="ts">
// ミドルウェアのタブ: 登録順(= 玉ねぎの外側から内側の順 = 実行順)に並べる
// 1段ずつ字下げして、最後にハンドラーを置くことで「外側から順に包んでいる」形を見せる
import { computed, onMounted, ref } from "vue";
import type { MiddlewareRow } from "../../../src/dev/page-data.ts";
import { anonymousHint, formatAverage, middlewareScope } from "../dashboard.ts";
import { useI18n } from "../i18n.ts";
import RichText from "./RichText.vue";

const props = defineProps<{ initial: MiddlewareRow[] }>();
const { t, lang } = useI18n();
const rows = ref<MiddlewareRow[]>(props.initial);
const hint = computed(() => anonymousHint(rows.value, lang));

// 開いたときに、最新の平均時間を取り直す
onMounted(async () => {
    const res = await fetch("/_senri/api/middleware");
    if (res.ok) rows.value = (await res.json()) as MiddlewareRow[];
});
</script>

<template>
    <section class="middleware" :aria-label="t('mw.label')">
        <h2 class="section">{{ t("mw.title", { count: rows.length }) }}</h2>
        <p class="lead">
            <RichText :text="t('mw.lead')" />
        </p>
        <ol class="mono onion">
            <li v-for="(m, i) in rows" :key="m.order" :style="{ paddingLeft: `${i * 20}px` }">
                <span class="order">{{ m.order }}</span>
                <span class="name">{{ m.name }}</span>
                <span class="scope">{{ middlewareScope(m.path, lang) }}</span>
                <span class="avg">{{ formatAverage(m, lang) }}</span>
            </li>
            <li class="handler" :style="{ paddingLeft: `${rows.length * 20}px` }">
                <span class="order">→</span>
                <span class="name">handler</span>
                <span class="scope">{{ t("mw.handler") }}</span>
                <span class="avg" />
            </li>
        </ol>
        <p v-if="rows.length === 0" class="lead">{{ t("mw.none") }}</p>
        <p v-if="hint" class="lead hint">{{ hint }}</p>
    </section>
</template>

<style scoped>
.middleware {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 960px;
}
.lead {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
}
.onion {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
}
.onion li {
    display: grid;
    grid-template-columns: 32px minmax(120px, 200px) 1fr max-content;
    gap: 16px;
    align-items: baseline;
    padding-top: 10px;
    padding-bottom: 10px;
    border-top: 1px solid var(--border);
}
.order {
    color: var(--accent-text);
    font-weight: 700;
}
.name {
    font-weight: 700;
}
.scope,
.avg {
    color: var(--muted);
}
.handler .name {
    color: var(--text);
}
.handler .order {
    color: var(--muted);
}
.hint {
    color: var(--help-text);
}
</style>
