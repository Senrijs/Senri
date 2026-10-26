<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ErrorPageData, PageFrame } from "../../src/dev/page-data.ts";
import { copyText, editorUrl } from "../../src/dev/editor-url.ts";
import SiteHeader from "./components/SiteHeader.vue";
import EditorSelect from "./components/EditorSelect.vue";
import CopyButton from "./components/CopyButton.vue";
import {
    editorOptions,
    formatMs,
    inlineCode,
    layerBars,
    loadEditor,
    openLabel,
    originText,
    saveEditor,
    visibleFrames,
} from "./view.ts";

const props = defineProps<{ data: ErrorPageData }>();
const d = props.data;

const storage = typeof localStorage === "undefined" ? undefined : localStorage;
const editor = ref(loadEditor(storage, d.editor));
watch(editor, (id) => saveEditor(storage, id));

const options = editorOptions(d.editor);
const openText = computed(() => openLabel(editor.value));
const locOf = (f: PageFrame) => ({ file: f.file, line: f.line, col: f.col, root: d.root });
const urlOf = (f: PageFrame) => editorUrl(editor.value, locOf(f));

const showInternal = ref(false);
const frames = computed(() => visibleFrames(d.frames, showInternal.value));
const internalCount = d.frames.filter((f) => f.kind === "senri").length;
const isLocation = (f: PageFrame) =>
    d.location !== null && f.file === d.location.file && f.line === d.location.line && f.col === d.location.col;

const bars = layerBars(d.layers);
const duration = formatMs(d.durationMs);
</script>

<template>
    <SiteHeader>
        <EditorSelect v-model="editor" :options="options" />
    </SiteHeader>

    <main>
        <!-- エラーの見出し(コンパイラのエラー表示風) -->
        <section class="head">
            <div class="mono summary">
                <span class="method">{{ d.request.method }}</span> {{ d.request.path }} · {{ d.status }}
                {{ d.statusText }}<template v-if="duration"> · {{ duration }}</template>
            </div>
            <h1>
                <span class="mono error-name">{{ d.error.name }}:</span> {{ d.error.message }}
            </h1>
            <div v-if="d.origin" class="mono location">
                <span class="muted">--&gt; <span class="text">{{ originText(d.origin) }}</span></span>
            </div>
            <div v-else-if="d.location" class="mono location">
                <span class="muted"
                    >--&gt; <span class="text">{{ d.location.display }}</span>:{{ d.location.line }}:{{
                        d.location.col
                    }}</span
                >
                <span class="actions">
                    <a v-if="openText && urlOf(d.location)" :href="urlOf(d.location)!" class="open">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M14 4h6v6" />
                            <path d="M20 4l-9 9" />
                            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                        </svg>
                        {{ openText }}
                    </a>
                    <CopyButton :text="copyText(locOf(d.location))" icon />
                </span>
            </div>
        </section>

        <!-- 該当コード -->
        <section v-if="d.code" class="mono code-frame" aria-label="エラーが起きたコード">
            <template v-for="ln in d.code.lines" :key="ln.num">
                <div class="code-line" :class="{ hit: ln.hit }">
                    <span class="num">{{ ln.num }}</span>
                    <span class="src">{{ ln.code || " " }}</span>
                </div>
                <div v-if="ln.hit" class="code-line">
                    <span class="num" />
                    <span class="caret">{{ d.code.caret }} {{ d.code.label }}</span>
                </div>
            </template>
        </section>

        <!-- ヒント -->
        <section v-if="d.hint" class="mono help">
            <span class="help-label">= help:</span>
            <span class="help-text"
                ><template v-for="(part, i) in inlineCode(d.hint.text)" :key="i"
                    ><code v-if="part.code">{{ part.text }}</code
                    ><template v-else>{{ part.text }}</template></template
                ></span
            >
            <template v-if="d.hint.code">
                <span />
                <code class="help-code">{{ d.hint.code }}</code>
            </template>
        </section>

        <!-- スタックトレース -->
        <section class="stack">
            <div class="mono stack-head">
                <h2 class="section">// スタックトレース</h2>
                <button v-if="internalCount > 0" type="button" class="toggle" @click="showInternal = !showInternal">
                    {{ showInternal ? "Senri 内部を隠す" : `Senri 内部も表示(${internalCount})` }}
                </button>
            </div>
            <ol class="mono frames">
                <li v-for="(f, i) in frames.shown" :key="i" :class="['frame', f.kind]">
                    <span class="mark">{{ isLocation(f) ? "›" : "" }}</span>
                    <span class="fn">{{ f.fn }}</span>
                    <span class="loc">{{ f.kind === "runtime" ? f.file : `${f.display}:${f.line}:${f.col}` }}</span>
                    <span v-if="f.kind !== 'runtime'" class="actions">
                        <a v-if="urlOf(f)" :href="urlOf(f)!" class="open-small">開く</a>
                        <CopyButton :text="copyText(locOf(f))" />
                    </span>
                </li>
                <li v-if="frames.hidden > 0" class="hidden-count">… Senri 内部のフレーム {{ frames.hidden }}件</li>
            </ol>
        </section>

        <!-- リクエストと、通った順番 -->
        <section class="mono details">
            <div class="detail">
                <h2 class="section">// リクエスト</h2>
                <dl>
                    <dt>method</dt>
                    <dd>{{ d.request.method }}</dd>
                    <dt>path</dt>
                    <dd>{{ d.request.path }}</dd>
                    <dt>route</dt>
                    <dd>{{ d.request.route ?? "(マッチなし)" }}</dd>
                    <dt>params</dt>
                    <dd>{{ JSON.stringify(d.request.params) }}</dd>
                    <template v-if="d.request.userAgent">
                        <dt>user-agent</dt>
                        <dd class="wrap">{{ d.request.userAgent }}</dd>
                    </template>
                </dl>
            </div>
            <div v-if="bars.length > 0" class="detail">
                <h2 class="section">// 通った順番</h2>
                <ol class="layers">
                    <li v-for="(l, i) in bars" :key="i" :class="{ failed: l.failed }">
                        <span class="layer-name">{{ l.name }}</span>
                        <span class="bar"><span :style="{ width: `${l.pct}%` }" /></span>
                        <span class="layer-ms">{{ l.ms }}</span>
                    </li>
                </ol>
                <a v-if="d.dashboardUrl" :href="d.dashboardUrl" class="dashboard-link">/_senri で詳しく見る →</a>
            </div>
        </section>

        <footer class="page-footer">
            このページは開発モード(<code>createApp({ dev: true })</code>)でのみ表示されます。本番では「{{
                d.production
            }}」だけが返ります。
        </footer>
    </main>
</template>

<style scoped>
.muted {
    color: var(--muted);
}
.text {
    color: var(--text);
}

.head {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.summary {
    font-size: 14px;
    color: var(--muted);
}
.method {
    color: var(--text);
    font-weight: 700;
}
h1 {
    margin: 0;
    font-size: 34px;
    line-height: 1.3;
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
}
.error-name {
    font-weight: 800;
    color: var(--accent-text);
}
.location {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    font-size: 14px;
}
.actions {
    display: flex;
    gap: 4px;
}
.open {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 6px;
    color: var(--accent-text);
    text-decoration: none;
    font-weight: 700;
}
.open:hover {
    text-decoration: underline;
}

.code-frame {
    font-size: 14px;
    line-height: 1.75;
    background: var(--code);
    border-radius: 8px;
    padding: 16px 0;
    overflow-x: auto;
}
.code-line {
    display: flex;
    white-space: pre;
    color: var(--muted);
}
.code-line.hit {
    background: var(--hit-bg);
    color: var(--text);
}
.num {
    width: 64px;
    flex-shrink: 0;
    text-align: right;
    padding-right: 20px;
    box-sizing: border-box;
    color: var(--num);
    user-select: none;
}
.hit .num {
    color: var(--accent-text);
}
.caret {
    color: var(--accent);
    font-weight: 700;
}

.help {
    font-size: 14px;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
}
.help-label {
    color: var(--help-text);
    font-weight: 700;
}
.help-text {
    font-family: var(--sans);
    font-size: 15px;
}
.help-code {
    color: var(--muted);
    white-space: pre;
    overflow-x: auto;
}

.stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.stack-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
}
.toggle {
    font-size: 13px;
    min-height: 32px;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: var(--muted);
    text-decoration: underline;
    cursor: pointer;
}
.frames {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
}
.frame {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
}
.frame.senri,
.frame.runtime {
    color: var(--muted);
}
.mark {
    width: 14px;
    color: var(--accent);
    font-weight: 800;
}
.fn {
    font-weight: 700;
    min-width: 120px;
}
.loc {
    color: var(--muted);
    flex: 1 1 280px;
    overflow-wrap: anywhere;
}
.open-small {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 8px;
    font-size: 13px;
}
.hidden-count {
    padding: 10px 0 10px 30px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 13px;
}

.details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 40px;
    font-size: 14px;
}
.detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 24px;
}
dt {
    color: var(--muted);
}
dd {
    margin: 0;
}
.wrap {
    overflow-wrap: anywhere;
}
.layers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.layers li {
    display: grid;
    grid-template-columns: 88px 1fr 72px;
    align-items: center;
    gap: 12px;
}
.layer-name {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
}
.bar {
    height: 6px;
    background: var(--code);
    display: block;
}
.bar span {
    display: block;
    height: 100%;
    background: var(--muted);
}
.failed .bar span {
    background: var(--accent);
}
.layer-ms {
    text-align: right;
    color: var(--muted);
}
.failed .layer-ms {
    color: var(--accent-text);
}
.dashboard-link {
    font-size: 13px;
    color: var(--accent-text);
}
</style>
