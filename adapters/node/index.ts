import { createServer } from "node:http";

type App = {
    fetch: (req:Request) => Response | Promise<Response>;
};

export function serve(app: App, options: { port: number }) {
    const server = createServer(async (req, res) => {
        const url = `http://${req.headers.host}${req.url}`;

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
                for (const v of value) headers.append(key, v);
            } else {
                headers.set(key, value);
            }
        }

        const request = new Request(url, {
            method: req.method,
            headers,
        });

        const response = await app.fetch(request);

        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
    });

    server.listen(options.port);
    return server;
}