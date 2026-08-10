// Servidor de desarrollo local que NO usa wrangler/workerd.
//
// Por qué existe: workerd (el runtime real de Cloudflare Workers) requiere
// macOS 13.5+, y esta máquina tiene una versión más vieja, así que
// `wrangler dev` falla con un error duro. El handler de src/index.ts,
// en cambio, es Fetch API estándar (Request/Response) sin bindings de
// Cloudflare (sin KV, sin Durable Objects, sin `env`/`ctx` reales) — así que
// corre igual en Node puro. Este archivo solo traduce entre el servidor HTTP
// de Node (node:http) y las Request/Response web-estándar que espera el
// handler, para poder probar las tools con curl o el MCP Inspector antes de
// depender de wrangler o de una cuenta de Cloudflare.
//
// Esto NO reemplaza probar con wrangler dev/deploy en algún momento (para
// confirmar que también corre bien dentro del runtime real de Cloudflare),
// pero para iterar sobre la lógica de las tools es equivalente: es el mismo
// código de src/index.ts.

import { existsSync } from "node:fs";
import http from "node:http";
import { Readable } from "node:stream";
import worker from "../src/index";

// `wrangler dev` carga `.dev.vars` automáticamente para simular secrets/vars
// en local; como este shim lo reemplaza, hay que cargarlo a mano acá.
const devVarsPath = new URL("../.dev.vars", import.meta.url);
if (existsSync(devVarsPath)) {
	process.loadEnvFile(devVarsPath);
}

const env = {
	CDP_API_KEY_ID: process.env.CDP_API_KEY_ID ?? "",
	CDP_API_KEY_SECRET: process.env.CDP_API_KEY_SECRET ?? "",
} as Env;

const PORT = Number(process.env.PORT ?? 8787);

function toWebHeaders(nodeHeaders: http.IncomingHttpHeaders): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(nodeHeaders)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const v of value) headers.append(key, v);
		} else {
			headers.set(key, value);
		}
	}
	return headers;
}

const server = http.createServer(async (req, res) => {
	try {
		const host = req.headers.host ?? `localhost:${PORT}`;
		const url = `http://${host}${req.url}`;
		const hasBody = req.method !== "GET" && req.method !== "HEAD";

		const request = new Request(url, {
			method: req.method,
			headers: toWebHeaders(req.headers),
			// @ts-expect-error -- Node necesita duplex:"half" para body streaming, no está tipado en RequestInit todavía.
			duplex: hasBody ? "half" : undefined,
			body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
		});

		// ctx está vacío porque este handler no usa bindings de Cloudflare más
		// allá de `env` (ver el comentario de arriba). Si en el futuro agregás
		// KV/DO/etc, este shim ya no alcanza y hay que probar con wrangler dev.
		const response = await worker.fetch(request, env, {} as ExecutionContext);

		res.statusCode = response.status;
		response.headers.forEach((value, key) => res.setHeader(key, value));

		if (response.body) {
			Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream).pipe(res);
		} else {
			res.end();
		}
	} catch (err) {
		res.statusCode = 500;
		res.end(`Error interno del shim de dev: ${err instanceof Error ? err.stack : String(err)}`);
	}
});

server.listen(PORT, () => {
	console.log(`MCP server (Node, sin wrangler) escuchando en http://localhost:${PORT}/mcp`);
});
