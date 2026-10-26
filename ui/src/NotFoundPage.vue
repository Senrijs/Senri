<script setup lang="ts">
import { computed, ref } from "vue";
import type { NotFoundPageData } from "../../src/dev/page-data.ts";
import SiteHeader from "./components/SiteHeader.vue";
import { methodColor, visibleRoutes } from "./view.ts";

const props = defineProps<{ data: NotFoundPageData }>();
const d = props.data;

// 絞り込んでいないときに出す件数
const LIMIT = 20;
const query = ref("");
const list = computed(() => visibleRoutes(d.routes, query.value, LIMIT));
</script>

<template>
    <SiteHeader>
        <a v-if="d.dashboardUrl" :href="d.dashboardUrl" class="mono dashboard-link">/_senri</a>
    </SiteHeader>

    <main>
        <section class="head">
            <div class="mono status">404 Not Found</div>
            <h1>
                <code class="target">{{ d.method }} {{ d.path }}</code> は見つかりませんでした
            </h1>
        </section>

        <!-- もしかして(コンパイラのエラー表示風) -->
        <section v-if="d.suggestion" class="mono suggestion">
            <span class="help-label">= もしかして:</span>
            <span />
            <span />
            <component
                :is="d.suggestion.link ? 'a' : 'span'"
                :href="d.suggestion.link ? d.suggestion.path : undefined"
                class="suggested"
            >
                <span class="method" :style="{ color: methodColor(d.suggestion.method) }">{{ d.suggestion.method }}</span>
                <span class="path"
                    ><template v-for="(part, i) in d.suggestion.parts" :key="i"
                        ><span v-if="part.mark" class="diff">{{ part.text }}</span
                        ><template v-else>{{ part.text }}</template></template
                    ></span
                >
                <svg
                    v-if="d.suggestion.link"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    class="arrow"
                >
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                </svg>
            </component>
            <span />
            <span class="note">{{ d.suggestion.note }}</span>
        </section>

        <!-- 登録されているルート -->
        <section class="routes">
            <div class="mono routes-head">
                <h2 class="section">// 登録されているルート({{ d.routes.length }})</h2>
                <div class="filter">
                    <label for="filter">filter</label>
                    <input id="filter" v-model="query" type="search" placeholder="/users" />
                </div>
            </div>
            <ul class="mono route-list">
                <li v-for="r in list.shown" :key="`${r.method} ${r.path}`">
                    <span class="route-method" :style="{ color: methodColor(r.method) }">{{ r.method }}</span>
                    <a v-if="r.link" :href="r.path">{{ r.path }}</a>
                    <span v-else>{{ r.path }}</span>
                </li>
                <li v-if="list.shown.length === 0" class="more">一致するルートはありません</li>
                <li v-if="list.rest > 0" class="more">… ほか {{ list.rest }} 件(filter で絞り込めます)</li>
            </ul>
        </section>

        <footer class="page-footer">
            このページは開発モード(<code>createApp({ dev: true })</code>)でのみ表示されます。本番では「404 Not
            Found」だけが返り、ルートの一覧は出ません。
        </footer>
    </main>
</template>

<style scoped>
.head {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.status {
    font-size: 14px;
    color: var(--muted);
}
h1 {
    margin: 0;
    font-size: 34px;
    line-height: 1.3;
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
}
.target {
    font-weight: 800;
    color: var(--warn-text);
}

.suggestion {
    font-size: 14px;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 10px 12px;
    align-items: center;
}
.help-label {
    color: var(--help-text);
    font-weight: 700;
}
.suggested {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    justify-self: start;
    min-height: 48px;
    padding: 0 16px;
    border-radius: 8px;
    background: var(--code);
    color: var(--text);
    text-decoration: none;
    font-size: 20px;
}
.suggested .method,
.suggested .path {
    font-weight: 700;
}
.diff {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 4px;
}
.arrow {
    color: var(--muted);
}
.note {
    color: var(--muted);
    font-size: 13px;
}
.dashboard-link {
    font-size: 13px;
    color: var(--muted);
}

.routes {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.routes-head {
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
}
.filter label {
    font-size: 13px;
    color: var(--muted);
}
.filter input {
    font-family: var(--mono);
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
.route-list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
}
.route-list li {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 9px 0;
    border-top: 1px solid var(--border);
    overflow-wrap: anywhere;
}
.route-method {
    width: 64px;
    flex-shrink: 0;
    font-weight: 700;
}
.more {
    padding-left: 80px !important;
    color: var(--muted);
    font-size: 13px;
}
</style>
