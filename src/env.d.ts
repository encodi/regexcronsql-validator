// Augmenta el `Env` generado por `wrangler types` (worker-configuration.d.ts)
// con los secrets que no vienen de un binding declarado en wrangler.jsonc.
// No se pudo regenerar automáticamente: `wrangler types` corre workerd para
// la parte de runtime types y esta Mac no lo soporta (ver README/memoria del
// macOS blocker). Declarado a mano vía declaration merging en vez de eso.
interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
}
