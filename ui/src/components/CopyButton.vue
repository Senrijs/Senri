<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ text: string; label?: string; icon?: boolean }>();
const done = ref(false);

async function copy() {
    try {
        await navigator.clipboard.writeText(props.text);
    } catch {
        // http(localhost 以外)などで Clipboard API が使えないときの代わり
        const area = document.createElement("textarea");
        area.value = props.text;
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
    }
    done.value = true;
    setTimeout(() => (done.value = false), 1500);
}
</script>

<template>
    <button type="button" class="copy" :title="text" @click="copy">
        <svg
            v-if="icon"
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
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a1 1 0 0 1 1-1h10" />
        </svg>
        <span aria-live="polite">{{ done ? "コピーしました" : (label ?? "コピー") }}</span>
    </button>
</template>

<style scoped>
.copy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 13px;
    cursor: pointer;
}
.copy:hover {
    color: var(--text);
}
</style>
