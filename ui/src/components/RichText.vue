<script setup lang="ts">
// 文言の `...` をコードとして表示する
import { inlineCode } from "../view.ts";

defineProps<{ text: string }>();
</script>

<template>
    <template v-for="(part, i) in inlineCode(text)" :key="i"
        ><code v-if="part.code">{{ part.text }}</code
        ><template v-else>{{ part.text }}</template></template
    >
</template>
