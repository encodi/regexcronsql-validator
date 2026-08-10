import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { getPaymentContext, PRICE_CRON, PRICE_REGEX, PRICE_SQL } from "./payments";
import { validarCron } from "./tools/cron";
import { MAX_STRING_LENGTH, MAX_TEST_STRINGS, validarRegex } from "./tools/regex";
import { MAX_QUERY_LENGTH, MAX_RESULT_ROWS, MAX_ROWS_PER_TABLE, MAX_TABLES, validarSql } from "./tools/sql";

// createServer() arma un McpServer nuevo y registra las tools disponibles.
// Cloudflare la invoca en cada request (ver createMcpHandler más abajo), así
// que no hay estado compartido entre llamadas: cada invocación de una tool
// es autocontenida, como pide el enunciado. Lo único que persiste entre
// requests (reusando el isolate "warm") es la configuración de cobro de
// getPaymentContext() — infraestructura, no datos de usuario; ver payments.ts.
async function createServer(env: Env) {
	const server = new McpServer({
		name: "regexcronsql-validator",
		version: "1.0.0",
	});

	const { paidRegex, paidCron, paidSql } = await getPaymentContext(env);

	// --- Tool 1: validar_regex ------------------------------------------------
	//
	// server.registerTool(nombre, config, callback) hace dos cosas:
	//
	// 1) Le dice al SDK cómo responder a "tools/list": el método JSON-RPC que un
	//    cliente/agente MCP llama primero para descubrir qué tools existen. El
	//    SDK convierte automáticamente los schemas de Zod (inputSchema,
	//    outputSchema) a JSON Schema y arma la entrada de la lista con
	//    { name, description, inputSchema, outputSchema }. Por eso las
	//    descripciones y .describe() de cada campo importan: son literalmente
	//    lo que el agente que llame a esta tool va a leer para saber qué
	//    mandar.
	//
	// 2) Registra el callback que se ejecuta cuando llega "tools/call" con
	//    name: "validar_regex". El SDK valida los argumentos recibidos contra
	//    inputSchema (si no cumplen el schema, ni siquiera llega a tu código:
	//    responde un error de protocolo) y recién ahí invoca el callback con
	//    los args ya tipados.
	server.registerTool(
		"validar_regex",
		{
			title: "Validar expresión regular",
			description: `Ejecuta un patrón de expresión regular (motor nativo de JavaScript) contra una lista de strings de prueba y devuelve, para cada uno, si hizo match, el match completo y los grupos capturados. Usa RegExp real, no una suposición del modelo sobre qué haría el patrón. Cuesta ${PRICE_REGEX} USDC (Base) por llamada.`,
			inputSchema: z.object({
				pattern: z
					.string()
					.describe(
						'El patrón de la expresión regular, sin delimitadores de barra (ej: "^[0-9]{3}-[0-9]{4}$", no "/^[0-9]{3}-[0-9]{4}$/").',
					),
				flags: z
					.string()
					.optional()
					.describe(
						'Flags de RegExp de JavaScript a aplicar (ej: "gi" para global + case-insensitive). Vacío por defecto.',
					),
				test_strings: z
					.array(z.string().max(MAX_STRING_LENGTH))
					.min(1)
					.max(MAX_TEST_STRINGS)
					.describe(
						`Lista de strings a evaluar contra el patrón, uno por uno. Máximo ${MAX_TEST_STRINGS} strings, ${MAX_STRING_LENGTH} caracteres cada uno.`,
					),
			}),
			outputSchema: z.object({
				valid_pattern: z.boolean().describe("false si el patrón no es una expresión regular válida en JS."),
				error: z.string().nullable().describe("Mensaje de error si valid_pattern es false; null si es válido."),
				results: z
					.array(
						z.object({
							test_string: z.string(),
							matched: z.boolean(),
							full_match: z.string().nullable(),
							groups: z.array(z.string().nullable()).nullable(),
						}),
					)
					.describe("Un resultado por cada test_string, en el mismo orden en que se recibieron."),
			}),
		},
		paidRegex(async ({ pattern, flags, test_strings }) => {
			const output = validarRegex({ pattern, flags, test_strings });
			return {
				// "content" es el resultado en formato "para humanos/LLM": el cliente
				// MCP casi siempre le muestra esto al modelo que llamó a la tool.
				content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
				// "structuredContent" es el mismo resultado pero como JSON tipado,
				// validado contra outputSchema. Útil para clientes que quieren
				// consumir el resultado programáticamente en vez de parsear texto.
				structuredContent: output,
			};
		}),
	);

	// --- Tool 2: validar_cron --------------------------------------------------
	server.registerTool(
		"validar_cron",
		{
			title: "Validar expresión cron",
			description: `Calcula las próximas ejecuciones reales de una expresión cron usando cron-parser (no una suposición del modelo sobre cuándo dispararía). Interpreta los campos en UTC para que el resultado no dependa de la zona horaria del servidor que corre la tool. Cuesta ${PRICE_CRON} USDC (Base) por llamada.`,
			inputSchema: z.object({
				cron_expression: z
					.string()
					.describe(
						'Expresión cron estándar de 5 campos (minuto hora día-mes mes día-semana), 6 con segundos, o un atajo como "@daily". Ej: "0 9 * * 1-5" = 9am de lunes a viernes.',
					),
				from_date: z
					.string()
					.optional()
					.describe(
						"Fecha ISO 8601 desde la cual calcular las próximas ejecuciones (ej: \"2026-08-07T00:00:00Z\"). Si se omite, se usa el momento actual.",
					),
				count: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Cantidad de próximas ejecuciones a devolver. Default 5, máximo 20."),
			}),
			outputSchema: z.object({
				valid_expression: z.boolean().describe("false si la expresión cron no es válida."),
				error: z.string().nullable().describe("Mensaje de error si valid_expression es false; null si es válida."),
				next_executions: z
					.array(z.string())
					.describe("Fechas ISO 8601 en UTC de las próximas ejecuciones, en orden cronológico."),
			}),
		},
		paidCron(async ({ cron_expression, from_date, count }) => {
			const output = validarCron({ cron_expression, from_date, count });
			return {
				content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
				structuredContent: output,
			};
		}),
	);

	// --- Tool 3: validar_sql ----------------------------------------------------
	server.registerTool(
		"validar_sql",
		{
			title: "Validar consulta SQL",
			description: `Ejecuta una consulta SQL (dialecto Postgres, motor pg-mem en memoria) contra tablas de prueba opcionales y devuelve las filas reales resultantes. Usa un motor SQL real, no una suposición del modelo sobre qué devolvería la query. Sin base de datos persistente: las tablas se crean desde cero en cada llamada y se descartan al terminar. Cuesta ${PRICE_SQL} USDC (Base) por llamada.`,
			inputSchema: z.object({
				query: z
					.string()
					.max(MAX_QUERY_LENGTH)
					.describe(`La consulta SQL a ejecutar (ej: "SELECT nombre FROM clientes WHERE activo = true"). Máximo ${MAX_QUERY_LENGTH} caracteres.`),
				tables: z
					.array(
						z.object({
							name: z.string().describe("Nombre de la tabla, tal como aparece en la query."),
							rows: z
								.array(z.record(z.string(), z.unknown()))
								.min(1)
								.max(MAX_ROWS_PER_TABLE)
								.describe(
									`Filas de prueba como objetos JSON (clave = columna). El tipo de cada columna se infiere del primer valor no nulo encontrado. Máximo ${MAX_ROWS_PER_TABLE} filas.`,
								),
						}),
					)
					.max(MAX_TABLES)
					.optional()
					.describe(`Tablas de prueba a crear antes de correr la query. Omitir si la query no referencia ninguna tabla. Máximo ${MAX_TABLES} tablas.`),
			}),
			outputSchema: z.object({
				valid_query: z.boolean().describe("false si la query tiene un error de sintaxis o de ejecución (ej: tabla inexistente)."),
				error: z.string().nullable().describe("Mensaje de error si valid_query es false; null si es válida."),
				rows: z
					.array(z.record(z.string(), z.unknown()))
					.describe(`Filas resultantes de la ejecución real de la query, hasta un máximo de ${MAX_RESULT_ROWS}.`),
				truncated: z.boolean().describe(`true si el resultado real tenía más de ${MAX_RESULT_ROWS} filas y se cortó.`),
			}),
		},
		paidSql(async ({ query, tables }) => {
			const output = validarSql({ query, tables });
			return {
				content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
				structuredContent: output,
			};
		}),
	);

	return server;
}

// createMcpHandler envuelve createServer() en un handler HTTP que implementa
// el transporte MCP completo (JSON-RPC sobre HTTP, incluyendo el manejo de
// "initialize", "tools/list" y "tools/call" descritos arriba). Al pasarle una
// función factory (no una instancia ya creada), el handler arma un McpServer
// nuevo por request entrante — coherente con "sin estado persistente, cada
// llamada autocontenida".
//
// createServer necesita `env` (para las credenciales de CDP en payments.ts),
// pero el factory que espera createMcpHandler no lo recibe directamente —
// así que se arma el handler una sola vez, capturando `env` por closure en el
// primer request. `env` no cambia entre requests de un mismo deploy (son
// bindings/secrets fijos, no datos por-request), así que cachearlo del primer
// request es seguro y evita reconstruir el handler en cada llamada.
let mcpHandler: ReturnType<typeof createMcpHandler> | null = null;

function getMcpHandler(env: Env) {
	mcpHandler ??= createMcpHandler(() => createServer(env));
	return mcpHandler;
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return getMcpHandler(env)(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
