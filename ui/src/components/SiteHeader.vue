<script setup lang="ts">
// ロゴ("senr" + 斜めの i)と、右側に置くもの(エディタの選択など)
</script>

<template>
    <header class="site-header">
        <div class="inner">
            <div class="brand mono">
                <span class="logo"
                    >senr<svg width="13" height="21" viewBox="4 0 34 54" role="img" aria-label="i">
                        <polygon points="5,54 15,54 30,19 20,19" fill="var(--accent)" />
                        <polygon points="22.6,13 32.6,13 36.5,4 26.5,4" fill="var(--accent)" /></svg
                ></span>
                <span class="dev">dev</span>
            </div>
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
.brand {
    display: flex;
    align-items: baseline;
    gap: 14px;
}
.logo {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
    display: inline-flex;
    align-items: flex-end;
}
.logo svg {
    margin-left: -1px;
}
.dev {
    font-size: 13px;
    color: var(--muted);
}
</style>
