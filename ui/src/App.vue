<script setup lang="ts">
import type { PageData } from "../../src/dev/page-data.ts";
import ErrorPage from "./ErrorPage.vue";
import NotFoundPage from "./NotFoundPage.vue";
import DashboardPage from "./DashboardPage.vue";

defineProps<{ data: PageData }>();
</script>

<template>
    <ErrorPage v-if="data.kind === 'error'" :data="data" />
    <NotFoundPage v-else-if="data.kind === 'notFound'" :data="data" />
    <DashboardPage v-else :data="data" />
</template>
