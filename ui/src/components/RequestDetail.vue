<script setup lang="ts">
// 1件のリクエストの詳細(ルート、エラー、玉ねぎタイムライン、ヘッダー)
import { computed } from "vue";
import type { DashboardRecord } from "../../../src/dev/dashboard/record.ts";
import { MASK } from "../../../src/dev/dashboard/mask.ts";
import { describeRequest, formatMs, formatTime, statusClass, timeline } from "../dashboard.ts";
import { methodColor } from "../view.ts";

const props = defineProps<{ record: DashboardRecord }>();

const bars = computed(() => timeline(props.record));
const note = computed(() => describeRequest(props.record));
</script>

<template>
    <section class="detail" aria-label="リクエストの詳細">
        <div class="title">
            <h1 class="mono">
                <span :style="{ color: methodColor(record.method) }">{{ record.method }}</span> {{ record.path
                }}<span class="query">{{ record.query }}</span>
            </h1>
            <div class="mono sub">
                <span :class="['status', statusClass(record.status)]">{{ record.status }}</span> ·
                {{ formatMs(record.durationMs) }} · {{ formatTime(record.time) }}
            </div>
        </div>

        <dl class="mono kv">
            <dt>route</dt>
            <dd>{{ record.route ?? "(一致なし)" }}</dd>
            <dt>params</dt>
            <dd>{{ JSON.stringify(record.params) }}</dd>
        </dl>

        <div v-if="record.error" class="mono error">
            <span class="error-name">{{ record.error.error.name }}:</span>
            <span class="error-message">{{ record.error.error.message }}</span>
            <a :href="`/_senri/api/requests/${record.id}/error`">エラーページで見る →</a>
        </div>

        <!-- 玉ねぎタイムライン -->
        <div class="block">
            <div class="mono block-head">
                <h2 class="section">// 玉ねぎタイムライン</h2>
                <span class="legend">
                    <span><i class="swatch self" />自分の時間</span>
                    <span><i class="swatch total" />下流の待ち時間</span>
                </span>
            </div>
            <div class="mono timeline">
                <div class="row axis">
                    <span />
                    <span class="axis-labels"><span>0ms</span><span>{{ formatMs(record.durationMs) }}</span></span>
                    <span />
                </div>
                <div v-for="(b, i) in bars" :key="i" :class="['row', b.state]">
                    <span class="name" :style="{ paddingLeft: `${b.indent * 14}px` }">{{ b.name }}</span>
                    <span class="track">
                        <span class="bar" :style="{ left: `${b.left}%`, width: `${b.width}%` }">
                            <span class="self" :style="{ width: `${b.selfWidth}%` }" />
                        </span>
                    </span>
                    <span class="label">{{ b.label }}</span>
                </div>
            </div>
            <p v-if="note" class="note">{{ note }}</p>
        </div>

        <!-- ヘッダー(機密のものは伏せてある) -->
        <div v-for="[title, headers] in [
            ['// リクエストヘッダー', record.requestHeaders],
            ['// レスポンスヘッダー', record.responseHeaders],
        ] as const" :key="title" class="mono block">
            <h2 class="section">{{ title }}</h2>
            <dl class="kv headers">
                <template v-for="([name, value], i) in headers" :key="i">
                    <dt>{{ name }}</dt>
                    <dd :class="{ masked: value === MASK }">{{ value === MASK ? "*** (伏せています)" : value }}</dd>
                </template>
            </dl>
        </div>
    </section>
</template>

<style scoped>
.detail {
    display: flex;
    flex-direction: column;
    gap: 28px;
    min-width: 0;
}
.title {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
}
.query {
    color: var(--muted);
    font-weight: 400;
}
.sub {
    font-size: 14px;
    color: var(--muted);
}
.status {
    font-weight: 700;
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
.kv {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 24px;
    font-size: 14px;
}
.kv dt {
    color: var(--muted);
}
.kv dd {
    margin: 0;
    overflow-wrap: anywhere;
}
.headers {
    font-size: 13px;
    gap: 4px 24px;
}
.masked {
    color: var(--muted);
}
.error {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 16px;
    font-size: 14px;
}
.error-name {
    font-weight: 800;
    color: var(--accent-text);
}
.error-message {
    font-family: var(--sans);
}
.error a {
    color: var(--accent-text);
    font-size: 13px;
}
.block {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.block-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
}
.legend {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--muted);
}
.legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.swatch {
    width: 14px;
    height: 8px;
    display: inline-block;
}
.swatch.self {
    background: var(--self-bg);
}
.swatch.total {
    background: var(--total-bg);
}
.timeline {
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.row {
    display: grid;
    grid-template-columns: 140px minmax(0, 1fr) 132px;
    gap: 12px;
    align-items: center;
}
.axis {
    font-size: 11px;
    color: var(--muted);
}
.axis-labels {
    display: flex;
    justify-content: space-between;
}
.name {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.track {
    position: relative;
    height: 18px;
    display: block;
    background: var(--track);
}
.bar {
    position: absolute;
    top: 0;
    bottom: 0;
    display: block;
    background: var(--total-bg);
}
.self {
    display: block;
    height: 100%;
    background: var(--self-bg);
}
.label {
    text-align: right;
    color: var(--muted);
    white-space: nowrap;
}
.row.stopped .self {
    background: var(--warn-text);
}
.row.stopped .label {
    color: var(--warn-text);
}
.row.failed .bar,
.row.failed .self {
    background: var(--accent);
}
.row.failed .name,
.row.failed .label {
    color: var(--accent-text);
}
.row.skipped .name {
    color: var(--muted);
}
.row.skipped .bar {
    background: transparent;
    outline: 1px dashed var(--border);
    outline-offset: -1px;
}
.row.skipped .self {
    display: none;
}
.note {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
}
</style>
