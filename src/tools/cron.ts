// Lógica pura de la tool "validar_cron". Igual que regex.ts: sin dependencias
// de Workers, para poder testearla con vitest en Node puro.

import { CronExpressionParser } from "cron-parser";

export interface ValidarCronInput {
	cron_expression: string;
	from_date?: string;
	count?: number;
}

export interface ValidarCronOutput {
	valid_expression: boolean;
	error: string | null;
	next_executions: string[];
}

const MAX_COUNT = 20;
const DEFAULT_COUNT = 5;

export function validarCron({ cron_expression, from_date, count = DEFAULT_COUNT }: ValidarCronInput): ValidarCronOutput {
	// cron-parser es sorprendentemente permisivo: "* * * *" (4 campos) o incluso
	// "" no tiran error, los interpreta con semántica propia en vez de fallar.
	// Como pedimos un error claro ante expresiones inválidas, validamos nosotros
	// la forma básica (5 campos estándar, 6 con segundos, o un atajo "@algo")
	// antes de delegarle el cálculo real a la librería.
	const trimmed = cron_expression.trim();
	const isShorthand = trimmed.startsWith("@");
	const fieldCount = trimmed.split(/\s+/).filter(Boolean).length;

	if (!isShorthand && (fieldCount < 5 || fieldCount > 6)) {
		return {
			valid_expression: false,
			error: `La expresión cron debe tener 5 campos (minuto hora día-mes mes día-semana) o 6 con segundos; se recibieron ${fieldCount}: "${cron_expression}"`,
			next_executions: [],
		};
	}

	if (from_date !== undefined && Number.isNaN(new Date(from_date).getTime())) {
		return {
			valid_expression: false,
			error: `from_date no es una fecha ISO válida: "${from_date}"`,
			next_executions: [],
		};
	}

	const boundedCount = Math.min(Math.max(1, Math.trunc(count)), MAX_COUNT);

	try {
		// tz: "UTC" fija la interpretación de los campos a UTC. Sin esto, cron-parser
		// usa la zona horaria local del proceso que lo corre, así que el mismo cron
		// expression + from_date daría resultados distintos según en qué máquina
		// (o región de Cloudflare) se ejecute la tool — justo lo que "ejecución
		// real" debería evitar.
		const interval = CronExpressionParser.parse(trimmed, {
			currentDate: from_date ?? new Date(),
			tz: "UTC",
		});

		// .toDate() da un Date nativo de JS; su toISOString() nunca es null, a
		// diferencia del de CronDate (que sí puede serlo en casos límite).
		const next_executions = interval.take(boundedCount).map((date) => date.toDate().toISOString());

		return { valid_expression: true, error: null, next_executions };
	} catch (err) {
		return {
			valid_expression: false,
			error: err instanceof Error ? err.message : String(err),
			next_executions: [],
		};
	}
}
