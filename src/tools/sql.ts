// Lógica pura de la tool "validar_sql". Igual que regex.ts y cron.ts: sin
// dependencias de Workers, para poder testearla con vitest en Node puro.
//
// "Ejecución real" acá significa correr la query contra un motor SQL de
// verdad (pg-mem: emulación en memoria de Postgres, parser propio, sin
// bindings nativos) en vez de que el modelo adivine el resultado. pg-mem es
// pura JS — funciona igual en Node (dev:node) y en el runtime de Workers.

import { newDb, DataType } from "pg-mem";
import type { IMemoryDb } from "pg-mem";

// Límites para evitar agotar CPU/memoria del Worker: pg-mem construye
// estructuras reales en memoria, así que un CROSS JOIN entre tablas grandes
// (o muchas tablas) o un generate_series sin acotar pueden ser costosos antes
// de que la query termine. Estos topes acotan el peor caso de entrada; el
// límite de CPU por request de Cloudflare es el respaldo final.
export const MAX_TABLES = 5;
export const MAX_ROWS_PER_TABLE = 200;
export const MAX_QUERY_LENGTH = 5000;
export const MAX_RESULT_ROWS = 500;

export interface SqlTableInput {
	name: string;
	rows: Record<string, unknown>[];
}

export interface ValidarSqlInput {
	query: string;
	tables?: SqlTableInput[];
}

export interface ValidarSqlOutput {
	valid_query: boolean;
	error: string | null;
	rows: Record<string, unknown>[];
	// true si el resultado real tenía más de MAX_RESULT_ROWS filas y se cortó
	// antes de devolverlo (la query sí corrió completa contra pg-mem).
	truncated: boolean;
}

function inferDataType(value: unknown): DataType {
	if (typeof value === "number") return Number.isInteger(value) ? DataType.integer : DataType.float;
	if (typeof value === "boolean") return DataType.bool;
	// strings, null/undefined (columna sin valores no-nulos) y objetos/arrays
	// (normalizados a JSON más abajo) caen todos en texto.
	return DataType.text;
}

function normalizeValue(value: unknown): unknown {
	if (value !== null && typeof value === "object") return JSON.stringify(value);
	return value;
}

function seedTable(db: IMemoryDb, table: SqlTableInput): void {
	const columnNames = Array.from(new Set(table.rows.flatMap((row) => Object.keys(row))));

	const memTable = db.public.declareTable({
		name: table.name,
		fields: columnNames.map((name) => {
			const firstNonNull = table.rows.find((row) => row[name] !== undefined && row[name] !== null)?.[name];
			return { name, type: inferDataType(firstNonNull) };
		}),
	});

	for (const row of table.rows) {
		const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]));
		memTable.insert(normalized);
	}
}

export function validarSql({ query, tables = [] }: ValidarSqlInput): ValidarSqlOutput {
	if (query.length > MAX_QUERY_LENGTH) {
		return {
			valid_query: false,
			error: `La query supera el máximo de ${MAX_QUERY_LENGTH} caracteres.`,
			rows: [],
			truncated: false,
		};
	}

	if (tables.length > MAX_TABLES) {
		return {
			valid_query: false,
			error: `Se recibieron ${tables.length} tablas; el máximo es ${MAX_TABLES}.`,
			rows: [],
			truncated: false,
		};
	}

	const tableWithTooManyRows = tables.find((table) => table.rows.length > MAX_ROWS_PER_TABLE);
	if (tableWithTooManyRows !== undefined) {
		return {
			valid_query: false,
			error: `La tabla "${tableWithTooManyRows.name}" tiene ${tableWithTooManyRows.rows.length} filas; el máximo por tabla es ${MAX_ROWS_PER_TABLE}.`,
			rows: [],
			truncated: false,
		};
	}

	// noErrorDiagnostic: true evita que pg-mem decore los errores de ejecución
	// con un párrafo de "andá a reportar un issue en GitHub" — nos quedamos
	// solo con el mensaje real (ej: 'relation "x" does not exist').
	const db = newDb({ noErrorDiagnostic: true });

	try {
		for (const table of tables) {
			seedTable(db, table);
		}

		const result = db.public.query(query);
		const rows = result.rows ?? [];
		return {
			valid_query: true,
			error: null,
			rows: rows.slice(0, MAX_RESULT_ROWS),
			truncated: rows.length > MAX_RESULT_ROWS,
		};
	} catch (err) {
		return {
			valid_query: false,
			error: err instanceof Error ? err.message : String(err),
			rows: [],
			truncated: false,
		};
	}
}
