<script setup lang="ts">
import type { EditorId } from "../../../src/dev/editor-url.ts";

defineProps<{ options: { id: EditorId; label: string }[] }>();
const model = defineModel<EditorId>({ required: true });
</script>

<template>
    <div class="editor mono">
        <label for="editor">editor</label>
        <select id="editor" v-model="model">
            <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
    </div>
</template>

<style scoped>
.editor {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
}
label {
    color: var(--muted);
}
select {
    font-size: 13px;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
}
</style>
