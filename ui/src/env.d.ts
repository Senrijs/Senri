/// <reference types="vite/client" />

// .vue ファイルを import できるようにする(型の中身までは見ない。テンプレートは Vite がコンパイルする)
declare module "*.vue" {
    import type { DefineComponent } from "vue";
    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
    export default component;
}
