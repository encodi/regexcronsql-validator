// Lógica pura de la tool "validar_regex". No depende de nada de Workers ni del
// SDK de MCP a propósito: así se puede testear con vitest normal (Node), sin
// necesitar el runtime de Cloudflare, y se puede reusar desde src/index.ts.

// Límites para evitar backtracking catastrófico (ReDoS): un patrón adversarial
// tipo "^(a+)+$" contra un string armado a propósito puede colgar la CPU del
// request. Cloudflare corta por límite de tiempo de CPU igual, pero acotar el
// tamaño de entrada reduce el peor caso antes de llegar a ese límite.
export const MAX_TEST_STRINGS = 50;
export const MAX_STRING_LENGTH = 2000;

export interface ValidarRegexInput {
	pattern: string;
	flags?: string;
	test_strings: string[];
}

export interface RegexTestResult {
	test_string: string;
	matched: boolean;
	full_match: string | null;
	groups: (string | null)[] | null;
}

export interface ValidarRegexOutput {
	valid_pattern: boolean;
	error: string | null;
	results: RegexTestResult[];
}

export function validarRegex({ pattern, flags = "", test_strings }: ValidarRegexInput): ValidarRegexOutput {
	if (test_strings.length > MAX_TEST_STRINGS) {
		return {
			valid_pattern: false,
			error: `Se recibieron ${test_strings.length} test_strings; el máximo es ${MAX_TEST_STRINGS}.`,
			results: [],
		};
	}

	const tooLong = test_strings.find((s) => s.length > MAX_STRING_LENGTH);
	if (tooLong !== undefined) {
		return {
			valid_pattern: false,
			error: `Un test_string supera el máximo de ${MAX_STRING_LENGTH} caracteres.`,
			results: [],
		};
	}

	// `new RegExp` es la única fuente de verdad: si el patrón es inválido para el
	// motor de JS, esto tira SyntaxError, y lo convertimos en un resultado de
	// error en vez de dejar que la excepción se propague y tumbe la tool.
	let compiled: RegExp;
	try {
		compiled = new RegExp(pattern, flags);
	} catch (err) {
		return {
			valid_pattern: false,
			error: err instanceof Error ? err.message : String(err),
			results: [],
		};
	}

	const results: RegexTestResult[] = test_strings.map((test_string) => {
		// Con flags "g" o "y" el regex guarda estado (lastIndex) entre llamadas a
		// exec(); lo reseteamos para que cada test_string se evalúe de forma
		// independiente y no se salteen matches por arrastre del string anterior.
		compiled.lastIndex = 0;
		const match = compiled.exec(test_string);

		if (!match) {
			return { test_string, matched: false, full_match: null, groups: null };
		}

		// match[0] es el match completo; match[1..] son los grupos de captura
		// numerados. Si no hay grupos definidos en el patrón, groups queda null.
		const groups = match.length > 1 ? match.slice(1).map((g) => g ?? null) : null;

		return { test_string, matched: true, full_match: match[0], groups };
	});

	return { valid_pattern: true, error: null, results };
}
