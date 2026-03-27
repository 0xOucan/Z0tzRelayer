/**
 * POST /bridge — Process a bridge lock event and mint on destination chain.
 *
 * Body: { lockId, sender, amount, srcChainId, destChainId, destRecipient }
 * Response: { success: boolean, transactionHash?: string, error?: string }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  loadConfigFromEnv,
  relayBridge,
  type BridgeRequest,
} from "../lib/relayer.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { lockId, sender, amount, srcChainId, destChainId, destRecipient } =
      req.body as BridgeRequest;

    if (!lockId || !sender || !amount || !srcChainId || !destChainId || !destRecipient) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: lockId, sender, amount, srcChainId, destChainId, destRecipient",
      });
    }

    const config = loadConfigFromEnv();
    const result = await relayBridge(
      { lockId, sender, amount, srcChainId, destChainId, destRecipient },
      config,
    );

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
}
