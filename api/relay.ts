/**
 * POST /relay — Submit a signed UserOperation for relay.
 *
 * Body: { userOp: UserOperation, chainId: number }
 * Response: { success: boolean, transactionHash?: string, error?: string }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { relayUserOp, loadConfigFromEnv, type UserOperation } from "../lib/relayer.js";

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_OPS_PER_MINUTE = Number(process.env.MAX_OPS_PER_MINUTE ?? 60);

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= MAX_OPS_PER_MINUTE) {
    return false;
  }

  entry.count++;
  return true;
}

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

  // Rate limit
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: "Rate limit exceeded" });
  }

  try {
    const { userOp, chainId } = req.body as {
      userOp: UserOperation;
      chainId: number;
    };

    if (!userOp || !chainId) {
      return res.status(400).json({
        success: false,
        error: "Missing userOp or chainId in request body",
      });
    }

    const config = loadConfigFromEnv();
    const result = await relayUserOp(userOp, chainId, config);

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: msg });
  }
}
