<script setup lang="ts">
import { provide } from "vue";
import type { PageData } from "../../src/dev/page-data.ts";
import { LANG } from "./i18n.ts";
import ErrorPage from "./ErrorPage.vue";
import NotFoundPage from "./NotFoundPage.vue";
import DashboardPage from "./DashboardPage.vue";

const props = defineProps<{ data: PageData }>();
provide(LANG, props.data.lang);
</script>

<template>
    <ErrorPage v-if="data.kind === 'error'" :data="data" />
    <NotFoundPage v-else-if="data.kind === 'notFound'" :data="data" />
    <DashboardPage v-else :data="data" />
</template>
