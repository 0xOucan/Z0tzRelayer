/**
 * GET /health — Relayer health check.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadConfigFromEnv } from "../lib/relayer.js";
import { privateKeyToAccount } from "viem/accounts";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const config = loadConfigFromEnv();
    const account = privateKeyToAccount(config.relayerPrivateKey);

    return res.status(200).json({
      status: "ok",
      relayer: account.address,
      entryPoint: config.entryPointAddress,
      chains: config.allowedChains,
      paymaster: config.paymasterAddress ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
