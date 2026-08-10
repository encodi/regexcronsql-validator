import { describe, expect, it } from "vitest";
import { validarCron } from "./cron";

describe("validarCron", () => {
	it('"0 9 * * 1-5" da horarios de lunes a viernes a las 9am UTC', () => {
		// 2026-08-07 es viernes.
		const out = validarCron({
			cron_expression: "0 9 * * 1-5",
			from_date: "2026-08-07T00:00:00Z",
			count: 5,
		});

		expect(out.valid_expression).toBe(true);
		expect(out.next_executions).toEqual([
			"2026-08-07T09:00:00.000Z", // viernes
			"2026-08-10T09:00:00.000Z", // lunes
			"2026-08-11T09:00:00.000Z", // martes
			"2026-08-12T09:00:00.000Z", // miércoles
			"2026-08-13T09:00:00.000Z", // jueves
		]);
	});

	it("usa count=5 por defecto cuando no se especifica", () => {
		const out = validarCron({ cron_expression: "@daily", from_date: "2026-08-07T00:00:00Z" });

		expect(out.valid_expression).toBe(true);
		expect(out.next_executions).toHaveLength(5);
	});

	it("clampea count a un máximo de 20", () => {
		const out = validarCron({
			cron_expression: "* * * * *",
			from_date: "2026-08-07T00:00:00Z",
			count: 100,
		});

		expect(out.next_executions).toHaveLength(20);
	});

	it("devuelve error claro con una expresión cron inválida, sin crashear", () => {
		const out = validarCron({ cron_expression: "esto no es un cron" });

		expect(out.valid_expression).toBe(false);
		expect(out.error).toBeTruthy();
		expect(out.next_executions).toEqual([]);
	});

	it("devuelve error claro con un from_date que no es fecha ISO válida", () => {
		const out = validarCron({ cron_expression: "0 9 * * 1-5", from_date: "no-es-una-fecha" });

		expect(out.valid_expression).toBe(false);
		expect(out.error).toContain("from_date");
	});
});
