<script setup lang="ts">
import type { MiddlewareRow, RouteRow } from "../../../src/dev/page-data.ts";

defineProps<{ routes: RouteRow[]; middlewares: MiddlewareRow[] }>();
</script>

<template>
    <p class="mono">ルートのタブは準備中です</p>
</template>
