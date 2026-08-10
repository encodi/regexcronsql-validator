import { describe, expect, it } from "vitest";
import { MAX_RESULT_ROWS, MAX_ROWS_PER_TABLE, MAX_TABLES, validarSql } from "./sql";

describe("validarSql", () => {
	it("ejecuta un SELECT contra una tabla de prueba y filtra/ordena de verdad", () => {
		const out = validarSql({
			query: "SELECT nombre, monto FROM ventas WHERE monto > 100 ORDER BY monto DESC",
			tables: [
				{
					name: "ventas",
					rows: [
						{ id: 1, nombre: "Ana", monto: 150.5 },
						{ id: 2, nombre: "Luis", monto: 42 },
						{ id: 3, nombre: "Cami", monto: 300 },
					],
				},
			],
		});

		expect(out.valid_query).toBe(true);
		expect(out.error).toBeNull();
		expect(out.rows).toEqual([
			{ nombre: "Cami", monto: 300 },
			{ nombre: "Ana", monto: 150.5 },
		]);
	});

	it("resuelve un JOIN entre dos tablas de prueba", () => {
		const out = validarSql({
			query: `
				SELECT clientes.nombre, pedidos.total
				FROM pedidos
				JOIN clientes ON clientes.id = pedidos.cliente_id
				ORDER BY pedidos.total DESC
			`,
			tables: [
				{ name: "clientes", rows: [{ id: 1, nombre: "Ana" }, { id: 2, nombre: "Luis" }] },
				{
					name: "pedidos",
					rows: [
						{ id: 1, cliente_id: 1, total: 500 },
						{ id: 2, cliente_id: 2, total: 90 },
					],
				},
			],
		});

		expect(out.valid_query).toBe(true);
		expect(out.rows).toEqual([
			{ nombre: "Ana", total: 500 },
			{ nombre: "Luis", total: 90 },
		]);
	});

	it("no crashea con SQL sintácticamente inválido: devuelve error claro", () => {
		const out = validarSql({ query: "ESTO NO ES SQL VALIDO ;;;" });

		expect(out.valid_query).toBe(false);
		expect(out.error).toBeTruthy();
		expect(out.rows).toEqual([]);
	});

	it("devuelve error claro al referenciar una tabla que no existe", () => {
		const out = validarSql({ query: "SELECT * FROM tabla_inexistente" });

		expect(out.valid_query).toBe(false);
		expect(out.error).toContain("tabla_inexistente");
	});

	it("funciona sin tablas para queries que no las necesitan", () => {
		const out = validarSql({ query: "SELECT 1 + 1 AS resultado" });

		expect(out.valid_query).toBe(true);
		expect(out.rows).toEqual([{ resultado: 2 }]);
		expect(out.truncated).toBe(false);
	});

	it("corta el resultado a MAX_RESULT_ROWS y lo marca como truncated", () => {
		// Un self CROSS JOIN de una tabla al tope permitido (MAX_ROWS_PER_TABLE)
		// da MAX_ROWS_PER_TABLE² filas, muy por encima de MAX_RESULT_ROWS.
		const rows = Array.from({ length: MAX_ROWS_PER_TABLE }, (_, i) => ({ id: i }));
		const out = validarSql({
			query: "SELECT a.id AS a_id, b.id AS b_id FROM t a, t b",
			tables: [{ name: "t", rows }],
		});

		expect(out.valid_query).toBe(true);
		expect(out.rows).toHaveLength(MAX_RESULT_ROWS);
		expect(out.truncated).toBe(true);
	});

	it("rechaza más de MAX_TABLES tablas de prueba", () => {
		const tables = Array.from({ length: MAX_TABLES + 1 }, (_, i) => ({
			name: `t${i}`,
			rows: [{ id: 1 }],
		}));

		const out = validarSql({ query: "SELECT 1", tables });

		expect(out.valid_query).toBe(false);
		expect(out.error).toContain(`${MAX_TABLES}`);
	});

	it("rechaza más de MAX_ROWS_PER_TABLE filas en una tabla", () => {
		const rows = Array.from({ length: MAX_ROWS_PER_TABLE + 1 }, (_, i) => ({ id: i }));

		const out = validarSql({ query: "SELECT 1", tables: [{ name: "t", rows }] });

		expect(out.valid_query).toBe(false);
		expect(out.error).toContain("t");
	});
});
