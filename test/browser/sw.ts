// Service Worker。/api/ へのリクエストだけ Senri が答える(ほかはネットワークへ)
import { createApp } from "../../src/index.ts";
import { setup } from "./app.ts";

type FetchEvent = Event & { request: Request; respondWith(response: Promise<Response>): void };
type WorkerScope = typeof globalThis & {
    skipWaiting(): Promise<void>;
    clients: { claim(): Promise<void> };
    addEventListener(type: string, listener: (event: any) => void): void;
};

const scope = globalThis as WorkerScope;
const app = setup(createApp());

scope.addEventListener("install", () => void scope.skipWaiting());
scope.addEventListener("activate", (event: Event & { waitUntil(p: Promise<unknown>): void }) => {
    event.waitUntil(scope.clients.claim());
});
scope.addEventListener("fetch", (event: FetchEvent) => {
    if (new URL(event.request.url).pathname.startsWith("/api/")) event.respondWith(app.fetch(event.request));
});
