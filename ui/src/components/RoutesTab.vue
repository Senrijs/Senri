<script setup lang="ts">
// ルートのタブ: 登録されているルートと、そこに来たリクエストが通るミドルウェアの順番
import { computed, ref } from "vue";
import type { MiddlewareRow, RouteRow } from "../../../src/dev/page-data.ts";
import { routeChain } from "../dashboard.ts";
import { filterRoutes, methodColor } from "../view.ts";

const props = defineProps<{ routes: RouteRow[]; middlewares: MiddlewareRow[] }>();

const query = ref("");
// 404 ページと同じ絞り込み(パスかメソッドに含まれるもの)。並びはパスの順
const rows = computed(() => {
    const matched = new Set(filterRoutes(props.routes.map((r) => ({ ...r, link: false })), query.value).map((r) => `${r.method} ${r.path}`));
    return [...props.routes]
        .filter((r) => matched.has(`${r.method} ${r.path}`))
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
});
// パラメーターのない GET(と all)はブラウザで開ける
const linkable = (r: RouteRow) => (r.method === "GET" || r.method === "ALL") && !r.path.includes(":");
</script>

<template>
    <section class="routes" aria-label="登録されているルート">
        <div class="mono head">
            <h2 class="section">// 登録されているルート({{ routes.length }})</h2>
            <div class="filter">
                <label for="route-filter">filter</label>
                <input id="route-filter" v-model="query" type="search" placeholder="/users" />
            </div>
        </div>
        <p class="lead">
            各ルートに来たリクエストが、どのミドルウェアをどの順に通ってハンドラーに着くかです(左が外側)。
            <span class="maybe-mark">*</span> はパスによってかかるもの(<code>:page</code> のようなパラメーターに何が来るか次第)です。
        </p>
        <ul class="mono list">
            <li v-for="r in rows" :key="`${r.method} ${r.path}`">
                <span class="method" :style="{ color: methodColor(r.method) }">{{ r.method }}</span>
                <a v-if="linkable(r)" :href="r.path" class="path">{{ r.path }}</a>
                <span v-else class="path">{{ r.path }}</span>
                <span class="chain">
                    <template v-for="(m, i) in routeChain(r)" :key="i">
                        <span v-if="i > 0" class="arrow" aria-hidden="true">→</span>
                        <span :class="{ handler: m.name === 'handler', maybe: m.maybe }"
                            >{{ m.name }}<span v-if="m.maybe" class="maybe-mark" title="パスによる">*</span></span
                        >
                    </template>
                </span>
            </li>
            <li v-if="rows.length === 0" class="empty">一致するルートはありません</li>
        </ul>
    </section>
</template>

<style scoped>
.routes {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
}
.filter {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
}
.filter label {
    color: var(--muted);
}
.filter input {
    font-size: 13px;
    min-height: 36px;
    width: 220px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
}
.lead {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
}
.list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
}
.list li {
    display: grid;
    grid-template-columns: 72px minmax(160px, 320px) 1fr;
    gap: 16px;
    align-items: baseline;
    padding: 9px 0;
    border-top: 1px solid var(--border);
}
.method {
    font-weight: 700;
}
.path {
    overflow-wrap: anywhere;
}
.chain {
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
}
.chain .handler {
    color: var(--text);
    font-weight: 700;
}
.maybe {
    font-style: italic;
}
.maybe-mark {
    color: var(--warn-text);
    margin-left: 2px;
}
.arrow {
    color: var(--border);
}
.empty {
    display: block !important;
    color: var(--muted);
}
</style>
