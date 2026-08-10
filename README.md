# regexcronsql-validator

Servidor MCP remoto (Cloudflare Workers, template `remote-mcp-authless`) con dos tools que validan contra **ejecución real**, no contra lo que un LLM cree que hacen:

- **`validar_regex`** — corre el patrón con `RegExp` nativo de JS contra una lista de strings.
- **`validar_cron`** — calcula las próximas ejecuciones reales de una expresión cron con [`cron-parser`](https://www.npmjs.com/package/cron-parser).
- **`validar_sql`** — ejecuta una consulta SQL (dialecto Postgres) contra tablas de prueba en memoria con [`pg-mem`](https://www.npmjs.com/package/pg-mem) y devuelve las filas reales resultantes.

Sin base de datos, sin estado persistente: cada llamada crea un `McpServer` nuevo (ver `createServer()` en `src/index.ts`) y es autocontenida — para `validar_sql` esto también aplica a las tablas de prueba: se crean desde cero en cada llamada (`pg-mem` en memoria) y se descartan al terminar.

## Cobro (x402)

Las tres tools cobran por llamada vía [x402](https://x402.org) — pago en USDC real sobre **Base mainnet**, sin API key, contra el facilitator público `x402.org/facilitator`. El pago viaja dentro del propio JSON-RPC de MCP (`_meta`), no como header HTTP; ver `src/payments.ts`.

| Tool | Precio |
|---|---|
| `validar_regex` | $0.02 USDC |
| `validar_cron` | $0.02 USDC |
| `validar_sql` | $0.04 USDC |

Un `tools/call` sin pago devuelve `isError: true` con los `accepts` (red, monto, `payTo`) que el cliente necesita para pagar y reintentar — no una excepción sin explicar. Un cliente MCP x402-aware con wallet propia (ej. `createX402MCPClient` de `@x402/mcp`) firma el pago y lo adjunta automáticamente; probarlo end-to-end requiere una wallet con fondos reales en Base mainnet y su clave privada, algo que este repo no maneja ni pide.

## Estructura

```
src/
  index.ts        # registra las tools en el McpServer y expone el handler HTTP MCP
  tools/
    regex.ts      # lógica pura de validar_regex (testeable sin Workers)
    regex.test.ts
    cron.ts       # lógica pura de validar_cron (testeable sin Workers)
    cron.test.ts
    sql.ts        # lógica pura de validar_sql (testeable sin Workers)
    sql.test.ts
scripts/
  dev-node.ts     # servidor de dev que corre el handler en Node puro, sin wrangler
```

## Correrlo local

⚠️ **Nota sobre `wrangler dev`**: el runtime real de Cloudflare Workers (`workerd`) requiere **macOS 13.5+**. Si tu Mac tiene una versión más vieja, `wrangler dev` (y `npm run dev`) van a fallar con `Unsupported macOS version`. Para ese caso este proyecto trae un shim en Node puro que corre exactamente el mismo `fetch()` handler sin necesitar `workerd`.

### 1. Instalar dependencias

```bash
npm install
```

### 2. Correr los tests unitarios

```bash
npm test
```

### 3a. Si tu wrangler dev funciona (macOS 13.5+, Linux, Windows)

```bash
npm run dev
```

Levanta en `http://localhost:8787/mcp`.

### 3b. Si `wrangler dev` falla por versión de macOS

```bash
npm run dev:node
```

Levanta el mismo handler en `http://localhost:8787/mcp` pero corriendo en Node directo (usa `tsx`, con watch mode). Ver el comentario en `scripts/dev-node.ts` para el detalle de por qué esto es seguro (el handler no usa bindings de Cloudflare como KV o Durable Objects).

### 4. Probar con curl

El transporte es MCP "Streamable HTTP": todo entra por POST a `/mcp` como JSON-RPC.

```bash
# 1) initialize (obligatorio primero en la mayoría de los clientes)
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"0.0.1"}}}'

# 2) tools/list — ver el JSON Schema real que expone cada tool
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3) tools/call — validar_regex
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"validar_regex","arguments":{"pattern":"^[0-9]{3}-[0-9]{4}$","test_strings":["555-1234","abc-1234"]}}}'

# 4) tools/call — validar_cron
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"validar_cron","arguments":{"cron_expression":"0 9 * * 1-5","from_date":"2026-08-07T00:00:00Z","count":5}}}'

# 5) tools/call — validar_sql
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"validar_sql","arguments":{"query":"SELECT nombre, monto FROM ventas WHERE monto > 100 ORDER BY monto DESC","tables":[{"name":"ventas","rows":[{"id":1,"nombre":"Ana","monto":150.5},{"id":2,"nombre":"Luis","monto":42}]}]}}}'
```

Las respuestas vienen como Server-Sent Events (una línea `event: message` + `data: {...}`); el `data:` es la respuesta JSON-RPC de siempre.

### 5. Probar con MCP Inspector (más cómodo que curl)

```bash
npx @modelcontextprotocol/inspector
```

Abre una UI en el navegador. Ahí:

1. Transport type: `Streamable HTTP`.
2. URL: `http://localhost:8787/mcp`.
3. Connect → pestaña **Tools** → `List Tools` → deberías ver `validar_regex`, `validar_cron` y `validar_sql` con sus schemas.
4. Elegí una tool, completá los inputs y `Run Tool` para ver el resultado real.

## Deploy y listados

Desplegado en `https://regexcronsql-validator.encodari.workers.dev/mcp` (Cloudflare Workers). Publicado en el [registry oficial de MCP](https://registry.modelcontextprotocol.io), [Smithery](https://smithery.ai/servers/encodari/regexcronsql-validator), [mcp.so](https://mcp.so) y con PR abierto a [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers).

La mayoría de los cambios de código son solo `npm run deploy` — no hace falta re-publicar en los listados salvo que cambie el precio, la descripción, o la URL del servidor. Ver [`ROADMAP.md`](./ROADMAP.md) para el detalle y el plan de mejoras a futuro.

### Cómo ver si se está usando

- **Pagos reales:** balance de USDC de la wallet de cobro en [BaseScan](https://basescan.org/address/0xF3aF5902240Ea7fb277748Ad5DA7Eb7582E5601e) — cada pago liquidado por x402 aparece ahí.
- **Tráfico (pagado o no):** dashboard de Cloudflare → Workers & Pages → `regexcronsql-validator` → Metrics.
- **Smithery:** tiene su propia página de stats por servidor.

## Qué NO hace (todavía)

- Cobra en Base mainnet con dinero real. Para volver a testnet (Base Sepolia, `eip155:84532`) durante desarrollo, cambiá `NETWORK` en `src/payments.ts`.
- No tiene base de datos ni estado persistente entre llamadas (más allá de la config de cobro, cacheada en memoria por isolate — ver `src/payments.ts`).
