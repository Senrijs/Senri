<script setup lang="ts">
// ミドルウェアのタブ: 登録順(= 玉ねぎの外側から内側の順 = 実行順)に並べる
// 1段ずつ字下げして、最後にハンドラーを置くことで「外側から順に包んでいる」形を見せる
import { onMounted, ref } from "vue";
import type { MiddlewareRow } from "../../../src/dev/page-data.ts";
import { formatAverage, middlewareScope } from "../dashboard.ts";

const props = defineProps<{ initial: MiddlewareRow[] }>();
const rows = ref<MiddlewareRow[]>(props.initial);

// 開いたときに、最新の平均時間を取り直す
onMounted(async () => {
    const res = await fetch("/_senri/api/middleware");
    if (res.ok) rows.value = (await res.json()) as MiddlewareRow[];
});
</script>

<template>
    <section class="middleware" aria-label="ミドルウェア">
        <h2 class="section">// ミドルウェア({{ rows.length }})</h2>
        <p class="lead">
            <code>app.use()</code> で登録した順に、外側から内側へ通ります。<code>next()</code>
            を呼ぶと次の行へ進み、ハンドラーまで行ったら、逆の順に戻ってきます。
        </p>
        <ol class="mono onion">
            <li v-for="(m, i) in rows" :key="m.order" :style="{ paddingLeft: `${i * 20}px` }">
                <span class="order">{{ m.order }}</span>
                <span class="name">{{ m.name }}</span>
                <span class="scope">{{ middlewareScope(m.path) }}</span>
                <span class="avg">{{ formatAverage(m) }}</span>
            </li>
            <li class="handler" :style="{ paddingLeft: `${rows.length * 20}px` }">
                <span class="order">→</span>
                <span class="name">handler</span>
                <span class="scope">マッチしたルートのハンドラー</span>
                <span class="avg" />
            </li>
        </ol>
        <p v-if="rows.length === 0" class="lead">まだミドルウェアは登録されていません。</p>
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
</style>
