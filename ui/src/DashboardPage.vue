<script setup lang="ts">
// 開発ダッシュボード(/_senri)。タブ: リクエスト / ルート / ミドルウェア
// 一覧は SSE(/_senri/api/events)で増えていく。詳細は行を選んだときに取りに行く
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { DashboardPageData, RequestSummary } from "../../src/dev/page-data.ts";
import type { DashboardRecord } from "../../src/dev/dashboard/record.ts";
import BrandLogo from "./components/BrandLogo.vue";
import RequestDetail from "./components/RequestDetail.vue";
import RoutesTab from "./components/RoutesTab.vue";
import MiddlewareTab from "./components/MiddlewareTab.vue";
import {
    applyEvent,
    filterRequests,
    formatMs,
    formatTime,
    STATUS_FILTERS,
    statusClass,
    type DashboardEvent,
    type StatusFilter,
} from "./dashboard.ts";
import { methodColor } from "./view.ts";

const props = defineProps<{ data: DashboardPageData }>();
const host = location.host;

// --- タブと選択(URL の # に入れておくと、再読み込みやリンクでも同じ画面になる) ---
// #requests / #requests/<id> / #routes / #middleware
type Tab = "requests" | "routes" | "middleware";
const tab = ref<Tab>("requests");
const selectedId = ref<string | null>(null);

function readHash() {
    const [name, id] = location.hash.replace(/^#/, "").split("/");
    tab.value = name === "routes" || name === "middleware" ? name : "requests";
    selectedId.value = tab.value === "requests" && id ? id : selectedId.value;
}

// --- 一覧(SSE で増える) ---
const requests = ref<RequestSummary[]>(props.data.requests);
const query = ref("");
const status = ref<StatusFilter>("all");
const visible = computed(() => filterRequests(requests.value, query.value, status.value));
const live = ref(false);

async function reload() {
    const res = await fetch("/_senri/api/requests");
    if (res.ok) requests.value = (await res.json()) as RequestSummary[];
}

let source: EventSource | null = null;
function connect() {
    source = new EventSource("/_senri/api/events");
    source.addEventListener("open", () => {
        // つなぎ直したときは、切れていた間の分を取り直す
        if (!live.value) void reload();
        live.value = true;
    });
    source.addEventListener("error", () => (live.value = false));
    source.addEventListener("request", (e) => {
        const item = JSON.parse((e as MessageEvent<string>).data) as RequestSummary;
        requests.value = applyEvent(requests.value, { type: "request", item } satisfies DashboardEvent, props.data.max);
        // まだ何も選んでいなければ、届いたものを開く
        if (selectedId.value === null) selectedId.value = item.id;
    });
    source.addEventListener("clear", () => {
        requests.value = applyEvent(requests.value, { type: "clear" }, props.data.max);
        selectedId.value = null;
    });
}

async function clearAll() {
    await fetch("/_senri/api/clear", { method: "POST" });
}

// --- 詳細(選んだときに取りに行く) ---
const detail = ref<DashboardRecord | null>(null);
const missing = ref(false);
watch(
    selectedId,
    async (id) => {
        detail.value = null;
        missing.value = false;
        if (id === null) return;
        const res = await fetch(`/_senri/api/requests/${encodeURIComponent(id)}`);
        if (res.ok) detail.value = (await res.json()) as DashboardRecord;
        else missing.value = true;
    },
    { immediate: false },
);

function pick(id: string) {
    location.hash = `requests/${id}`;
}

onMounted(() => {
    readHash();
    if (selectedId.value === null) selectedId.value = requests.value[0]?.id ?? null;
    window.addEventListener("hashchange", readHash);
    connect();
});
onUnmounted(() => {
    window.removeEventListener("hashchange", readHash);
    source?.close();
});
</script>

<template>
    <header class="dash-header">
        <div class="inner mono">
            <div class="left">
                <BrandLogo />
                <nav aria-label="ダッシュボードのメニュー">
                    <a href="#requests" :aria-current="tab === 'requests' ? 'page' : undefined">リクエスト</a>
                    <a href="#routes" :aria-current="tab === 'routes' ? 'page' : undefined"
                        >ルート <span class="count">{{ data.routes.length }}</span></a
                    >
                    <a href="#middleware" :aria-current="tab === 'middleware' ? 'page' : undefined"
                        >ミドルウェア <span class="count">{{ data.middlewares.length }}</span></a
                    >
                </nav>
            </div>
            <div class="right">
                <span class="live"><i :class="{ on: live }" aria-hidden="true" />{{ live ? "live" : "offline" }}</span>
                <span>{{ host }}</span>
                <button v-if="tab === 'requests'" type="button" @click="clearAll">クリア</button>
            </div>
        </div>
    </header>

    <main v-if="tab === 'requests'" class="dash-main requests">
        <section class="list" aria-label="リクエスト一覧">
            <div class="mono toolbar">
                <div class="filter">
                    <label for="q">filter</label>
                    <input id="q" v-model="query" type="search" placeholder="/users" />
                </div>
                <div role="group" aria-label="ステータスで絞り込む" class="status-filters">
                    <button
                        v-for="f in STATUS_FILTERS"
                        :key="f.id"
                        type="button"
                        :aria-pressed="status === f.id"
                        @click="status = f.id"
                    >
                        {{ f.label }}
                    </button>
                </div>
            </div>

            <div class="mono rows">
                <div class="row head"><span>// 時刻</span><span>method</span><span>path</span><span>status</span><span class="num">time</span></div>
                <button
                    v-for="r in visible"
                    :key="r.id"
                    type="button"
                    class="row"
                    :aria-pressed="r.id === selectedId"
                    @click="pick(r.id)"
                >
                    <span class="muted">{{ formatTime(r.time).slice(0, 8) }}</span>
                    <span class="method" :style="{ color: methodColor(r.method) }">{{ r.method }}</span>
                    <span class="path">{{ r.path }}</span>
                    <span :class="['status', statusClass(r.status)]">{{ r.status }}</span>
                    <span :class="['num', { slow: r.durationMs >= 10 }]">{{ formatMs(r.durationMs) }}</span>
                </button>
                <p v-if="visible.length === 0" class="empty">
                    {{ requests.length === 0 ? "まだリクエストがありません。アプリを開くと、ここに増えていきます。" : "一致するリクエストはありません" }}
                </p>
            </div>
            <div class="mono foot">直近 {{ data.max }} 件まで保持 · 再起動で消えます</div>
        </section>

        <RequestDetail v-if="detail" :record="detail" class="detail-pane" />
        <p v-else-if="missing" class="detail-pane empty">
            この記録はもうありません(直近 {{ data.max }} 件だけ保持しています)。
        </p>
    </main>

    <main v-else-if="tab === 'routes'" class="dash-main"><RoutesTab :routes="data.routes" :middlewares="data.middlewares" /></main>
    <main v-else class="dash-main"><MiddlewareTab :initial="data.middlewares" /></main>
</template>

<style scoped>
.dash-header {
    border-bottom: 1px solid var(--border);
}
.inner {
    padding: 0 32px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 24px;
}
.left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 28px;
}
.left :deep(.brand) {
    padding: 14px 0;
}
nav {
    display: flex;
    gap: 4px;
    font-size: 14px;
}
nav a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 12px;
    color: var(--muted);
    text-decoration: none;
}
nav a[aria-current="page"] {
    color: var(--text);
    font-weight: 700;
    box-shadow: inset 0 -2px 0 var(--accent);
}
.count {
    margin-left: 6px;
}
.right {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 13px;
    color: var(--muted);
}
.live {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.live i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
    display: inline-block;
}
.live i.on {
    background: var(--live);
}
.right button,
.status-filters button {
    font-size: 13px;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 6px;
    cursor: pointer;
}
.right button {
    border: 1px solid var(--border);
    background: transparent;
}

/* theme.css の main(エラーページ用の、幅を絞った縦並び)を、ダッシュボードでは全幅にする */
.dash-main {
    max-width: none;
    margin: 0;
    padding: 24px 32px 48px;
    display: block;
}
.requests {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 32px;
}
.list {
    flex: 1 1 640px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.detail-pane {
    flex: 1 1 520px;
}
.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
}
.filter {
    display: flex;
    align-items: center;
    gap: 10px;
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
.status-filters {
    display: flex;
    gap: 2px;
}
.status-filters button {
    border: none;
    background: transparent;
    color: var(--muted);
}
.status-filters button[aria-pressed="true"] {
    background: var(--row-sel);
    color: var(--text);
    font-weight: 700;
}
.rows {
    font-size: 14px;
}
.row {
    display: grid;
    grid-template-columns: 92px 72px minmax(0, 1fr) 56px 72px;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-top: 1px solid var(--border);
    background: transparent;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
}
.row.head {
    border-top: none;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--muted);
    cursor: default;
}
.row[aria-pressed="true"] {
    background: var(--row-sel);
}
.muted {
    color: var(--muted);
}
.method,
.status {
    font-weight: 700;
}
.path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.status.ok {
    color: var(--ok);
}
.status.redirect {
    color: var(--redirect);
}
.status.warn {
    color: var(--warn-text);
}
.status.error {
    color: var(--accent-text);
}
.num {
    text-align: right;
    color: var(--muted);
}
.num.slow {
    color: var(--warn-text);
}
.foot {
    font-size: 12px;
    color: var(--muted);
}
.empty {
    margin: 0;
    padding: 16px 12px;
    color: var(--muted);
    font-size: 14px;
}
</style>
