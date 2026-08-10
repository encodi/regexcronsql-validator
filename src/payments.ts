// Capa de cobro con x402: cada tool call paga una vez antes de ejecutarse.
// El pago viaja dentro del propio JSON-RPC de MCP (campo `_meta`), no como
// header HTTP — por eso no hace falta tocar el transporte, solo envolver los
// handlers de cada tool con `paid(...)`.
//
// Red: Base mainnet — dinero real (USDC de verdad). eip155:8453 es el chain
// id CAIP-2 de Base; eip155:84532 sería Base Sepolia (testnet).
//
// Facilitator: el público de x402.org (`https://x402.org/facilitator`) NO
// soporta Base mainnet — probado en vivo, solo tiene testnets (Base Sepolia,
// Solana devnet, etc.). Para cobrar en mainnet hace falta el facilitator de
// Coinbase Developer Platform (CDP), que sí soporta Base real. Necesita una
// API key gratis (CDP_API_KEY_ID / CDP_API_KEY_SECRET, seteadas como secrets
// de Wrangler — nunca hardcodeadas acá ni committeadas).

import { createFacilitatorConfig } from "@coinbase/x402";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

export const NETWORK = "eip155:8453";
export const PAY_TO = "0xF3aF5902240Ea7fb277748Ad5DA7Eb7582E5601e";

export const PRICE_REGEX = "$0.02";
export const PRICE_CRON = "$0.02";
export const PRICE_SQL = "$0.04";

type PaymentWrapper = ReturnType<typeof createPaymentWrapper>;

export interface PaymentWrappers {
	paidRegex: PaymentWrapper;
	paidCron: PaymentWrapper;
	paidSql: PaymentWrapper;
}

async function buildPaymentContext(cdpApiKeyId: string, cdpApiKeySecret: string): Promise<PaymentWrappers> {
	const facilitatorConfig = createFacilitatorConfig(cdpApiKeyId, cdpApiKeySecret);
	const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
	const resourceServer = new x402ResourceServer(facilitatorClient);
	resourceServer.register(NETWORK, new ExactEvmScheme());
	// initialize() le pregunta al facilitator qué esquemas/redes soporta —
	// es la única llamada de red de todo este archivo.
	await resourceServer.initialize();

	const wrapperFor = async (price: string) => {
		const accepts = await resourceServer.buildPaymentRequirements({
			scheme: "exact",
			network: NETWORK,
			payTo: PAY_TO,
			price,
		});
		return createPaymentWrapper(resourceServer, { accepts });
	};

	const [paidRegex, paidCron, paidSql] = await Promise.all([wrapperFor(PRICE_REGEX), wrapperFor(PRICE_CRON), wrapperFor(PRICE_SQL)]);

	return { paidRegex, paidCron, paidSql };
}

// Memoizado a nivel de módulo: el isolate de Workers se reusa entre requests
// (warm start), así que resourceServer.initialize() y buildPaymentRequirements
// corren una sola vez por isolate, no en cada llamada. Si falla (facilitator
// caído, credenciales inválidas), se limpia el cache para que el próximo
// request reintente en vez de quedar roto hasta que el isolate se recicle.
let paymentContextPromise: Promise<PaymentWrappers> | null = null;

export function getPaymentContext(env: Pick<Env, "CDP_API_KEY_ID" | "CDP_API_KEY_SECRET">): Promise<PaymentWrappers> {
	if (!paymentContextPromise) {
		paymentContextPromise = buildPaymentContext(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET).catch((err) => {
			paymentContextPromise = null;
			throw err;
		});
	}
	return paymentContextPromise;
}
