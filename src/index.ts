export function createApp() {
    return {
        fetch(req: Request): Response {
            const url = new URL(req.url);
            const path = url.pathname;
            return new Response(`Hello from Senri! Path: ${path}`);
        }
    }
}