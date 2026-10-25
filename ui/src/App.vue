<script setup lang="ts">
import type { PageData } from "../../src/dev/page-data.ts";
import ErrorPage from "./ErrorPage.vue";

defineProps<{ data: PageData }>();
</script>

<template>
    <ErrorPage v-if="data.kind === 'error'" :data="data" />
    <main v-else>
        <p class="mono">{{ data.method }} {{ data.path }}</p>
    </main>
</template>
