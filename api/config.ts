/**
 * GET /config — Public config for CLI/GUI to discover the relayer.
 * Returns contract addresses and supported chains (no secrets).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadConfigFromEnv } from "../lib/relayer.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const config = loadConfigFromEnv();

    return res.status(200).json({
      entryPoint: config.entryPointAddress,
      paymaster: config.paymasterAddress ?? null,
      accountFactory: config.accountFactoryAddress ?? null,
      chains: config.allowedChains,
    });
  } catch (error) {
    return res.status(500).json({ error: "Relayer misconfigured" });
  }
}
