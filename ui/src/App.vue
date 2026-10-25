<script setup lang="ts">
import type { PageData } from "../../src/dev/page-data.ts";

defineProps<{ data: PageData }>();
</script>

<template>
    <main>
        <p class="mono">{{ data.kind === "error" ? data.error.message : `${data.method} ${data.path}` }}</p>
    </main>
</template>
