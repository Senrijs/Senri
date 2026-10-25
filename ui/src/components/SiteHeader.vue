<script setup lang="ts">
// ロゴと、右側に置くもの(エディタの選択など)
import BrandLogo from "./BrandLogo.vue";
</script>

<template>
    <header class="site-header">
        <div class="inner">
            <BrandLogo />
            <slot />
        </div>
    </header>
</template>

<style scoped>
.site-header {
    border-bottom: 1px solid var(--border);
}
.inner {
    max-width: 1080px;
    margin: 0 auto;
    padding: 14px 32px;
    box-sizing: border-box;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}
</style>
