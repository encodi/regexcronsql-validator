# Roadmap

Plan de mejoras futuras para `regexcronsql-validator`, organizado en fases. La idea no es hacer todo esto ya — cada fase tiene una condición de entrada ("hacé esto cuando..."), así que el ritmo lo marca el uso real, no el calendario.

**Cómo confirmar uso real:** ver la sección "Cómo ver si se está usando" en el README, o el balance de la wallet `0xF3aF5902240Ea7fb277748Ad5DA7Eb7582E5601e` en [BaseScan](https://basescan.org/address/0xF3aF5902240Ea7fb277748Ad5DA7Eb7582E5601e).

**Cuándo hay que re-deployar / re-publicar:** casi cualquier cambio de código es solo `npm run deploy`. Solo hace falta tocar el registry oficial (`mcp-publisher publish`) si cambia el precio, la descripción, o se agrega/saca una tool. Cambiar la URL del Worker o la wallet de cobro sí requiere actualizar todos los listados.

---

## Fase 0 — Hecho (línea base, 2026-08-10)

- 3 tools (`validar_regex`, `validar_cron`, `validar_sql`) validando contra ejecución real.
- Límites anti-ReDoS / anti-resource-exhaustion en las tres.
- Cobro por llamada vía x402 en Base mainnet (facilitator de CDP).
- Desplegado, publicado en registry oficial de MCP, Smithery, mcp.so, y PR a awesome-mcp-servers.

---

## Fase 1 — Confirmar que se usa (sin escribir código)

**Entrar cuando:** siempre, es el primer paso antes de invertir tiempo en más fases.

- [ ] Revisar BaseScan y el dashboard de Cloudflare cada tanto (semanal al principio).
- [ ] Si a las ~4-6 semanas no hay ni tráfico ni pagos: el problema no es el código, es discoverability — revisar si el PR a awesome-mcp-servers se mergeó, si Glama ya indexó el repo, considerar postear en algún lugar donde haya agentes/devs buscando tools (ej. foros de MCP, Discord de Anthropic/Cloudflare).
- [ ] Si hay tráfico pero cero pagos: revisar si el flujo de `payment required` está devolviendo algo que un cliente x402 real pueda consumir (probar con un cliente x402 de verdad, no solo curl).

No requiere cambios de código — es pura observación.

---

## Fase 2 — Endurecer para tráfico real

**Entrar cuando:** ya hay tráfico o pagos reales confirmados (Fase 1 dio señal positiva).

- [ ] **CI básico**: GitHub Action que corra `npm test`, `type-check` y `oxlint` en cada push/PR — ahora mismo todo eso es manual.
- [ ] **Logging/monitoreo de errores**: hoy la única forma de ver un error en producción es `wrangler tail` corriendo en el momento exacto. Evaluar Cloudflare Logpush o un servicio tipo Sentry para no perder errores que pasan cuando nadie está mirando.
- [ ] **Rotación de credenciales**: agendar rotar `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` cada tanto (ej. cada 6 meses), vía `wrangler secret put` en terminal propia — nunca por chat.
- [ ] **Revisar `npm audit`** periódicamente — en particular la vulnerabilidad conocida de `axios` (pinned por `@coinbase/cdp-sdk`) y las de las devDependencies de test/build.
- [ ] **Rate limiting a nivel de Cloudflare** (no solo el gate de pago): un atacante mandando `tools/call` sin pagar igual gasta CPU nuestro (validación de schema + intento de armar el `accepts`) y, potencialmente, cupo de llamadas al facilitator de CDP. Evaluar una regla de rate limiting en Cloudflare para requests no pagados repetidos desde la misma IP.
- [ ] **Tests de integración del flujo de pago**: los tests actuales cubren la lógica pura de las tools, no el wrapper de x402. Agregar tests que mockeen el facilitator y verifiquen que `paidRegex`/`paidCron`/`paidSql` rechazan sin pago y aceptan con un payload de pago válido simulado.

---

## Fase 3 — Expandir features

**Entrar cuando:** hay uso sostenido (no solo un pico) y/o pedidos concretos de usuarios.

Ideas, en orden de qué tan bien encajan con el patrón actual ("validar contra ejecución real"):

- [ ] **Más tools del mismo estilo**: candidatas naturales — validar JSON Schema, validar una query GraphQL contra un schema, validar XPath/XML. Solo si hay señal de demanda, no especulativo.
- [ ] **Precio dinámico para `validar_sql`**: hoy es un precio flat ($0.04) sin importar si la query es trivial o pesada. Evaluar cobrar según complejidad (cantidad de filas/tablas involucradas) si el uso lo justifica.
- [ ] **Soporte multi-red**: hoy solo Base. Si aparecen compradores que prefieren pagar en Solana u otra red que el facilitator de CDP soporte, evaluar agregar `resourceServer.register()` para esa red también (el código ya está armado para soportar múltiples redes, solo falta registrarlas).
- [ ] **Recibos/hooks de `@x402/mcp`**: el paquete ya soporta `onAfterSettlement` para mandar un recibo o loguear cada pago liquidado — hoy no lo usamos. Útil una vez que valga la pena tener contabilidad más fina que "mirar BaseScan".

---

## Fase 4 — Madurar el negocio

**Entrar cuando:** hay ingresos recurrentes que justifican más inversión de tiempo.

- [ ] Evaluar el esquema `subscription`/`upto` de x402 (visto en los kinds que soporta el facilitator) para compradores frecuentes, en vez de cobrar por llamada siempre.
- [ ] Si el volumen de transacciones supera el tier gratuito de CDP (históricamente ~1000/mes), revisar el pricing de CDP para volumen mayor.
- [ ] Optimizar metadata para el x402 Bazaar una vez que haya historial de transacciones real.
- [ ] Considerar upgrade de infraestructura si `validar_sql` empieza a pegarle seguido al límite de CPU del plan Paid de Cloudflare.
