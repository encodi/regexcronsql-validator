import { describe, expect, it } from "vitest";
import { validarRegex } from "./regex";

describe("validarRegex", () => {
	it("matchea un string que cumple el patrón y falla el que no", () => {
		const out = validarRegex({
			pattern: "^[0-9]{3}-[0-9]{4}$",
			test_strings: ["555-1234", "abc-1234"],
		});

		expect(out.valid_pattern).toBe(true);
		expect(out.results[0]).toEqual({
			test_string: "555-1234",
			matched: true,
			full_match: "555-1234",
			groups: null,
		});
		expect(out.results[1]).toEqual({
			test_string: "abc-1234",
			matched: false,
			full_match: null,
			groups: null,
		});
	});

	it("devuelve los grupos capturados en orden", () => {
		const out = validarRegex({
			pattern: "^(\\d{4})-(\\d{2})-(\\d{2})$",
			test_strings: ["2026-08-07"],
		});

		expect(out.results[0].matched).toBe(true);
		expect(out.results[0].full_match).toBe("2026-08-07");
		expect(out.results[0].groups).toEqual(["2026", "08", "07"]);
	});

	it("respeta las flags (case-insensitive)", () => {
		const sinFlag = validarRegex({ pattern: "^hola$", test_strings: ["HOLA"] });
		const conFlag = validarRegex({ pattern: "^hola$", flags: "i", test_strings: ["HOLA"] });

		expect(sinFlag.results[0].matched).toBe(false);
		expect(conFlag.results[0].matched).toBe(true);
	});

	it("no crashea con un patrón inválido: devuelve error claro", () => {
		const out = validarRegex({ pattern: "(unclosed", test_strings: ["cualquier cosa"] });

		expect(out.valid_pattern).toBe(false);
		expect(out.error).toBeTruthy();
		expect(out.results).toEqual([]);
	});

	it("con flag global, cada test_string se evalúa desde cero (no arrastra lastIndex)", () => {
		const out = validarRegex({
			pattern: "\\d+",
			flags: "g",
			test_strings: ["abc123", "def456"],
		});

		expect(out.results[0].full_match).toBe("123");
		expect(out.results[1].full_match).toBe("456");
	});
});
