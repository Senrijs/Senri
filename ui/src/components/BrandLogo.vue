<script setup lang="ts">
// ロゴ("senr" + 斜めの i)と "dev"
</script>

<template>
    <div class="brand mono">
        <span class="logo"
            >senr<svg width="13" height="21" viewBox="4 0 34 54" role="img" aria-label="i">
                <polygon points="5,54 15,54 30,19 20,19" fill="var(--accent)" />
                <polygon points="22.6,13 32.6,13 36.5,4 26.5,4" fill="var(--accent)" /></svg
        ></span>
        <span class="dev">dev</span>
    </div>
</template>

<style scoped>
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
