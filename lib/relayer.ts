/**
 * Z0tz Relayer — submits signed UserOperations to the EntryPoint.
 *
 * The relayer pays ETH gas upfront and gets reimbursed by the Z0tzPaymaster.
 * Users never need ETH — they pay a small token fee (1%) via the paymaster.
 *
 * This module is framework-agnostic: works in Vercel serverless, Express,
 * or embedded in the CLI/GUI for P2P relay mode.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia, arbitrumSepolia, baseSepolia } from "viem/chains";

export interface UserOperation {
  sender: Address;
  nonce: string; // hex
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: string; // hex
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

export interface RelayerConfig {
  relayerPrivateKey: Hex;
  rpcUrls: Record<number, string>;
  entryPointAddress: Address;
  allowedChains: number[];
  paymasterAddress?: Address;
  accountFactoryAddress?: Address;
  bridgeAddresses: Record<number, string>;  // chainId => bridge contract address
  paymasterAddresses: Record<number, string>; // chainId => paymaster address
  factoryAddresses: Record<number, string>;   // chainId => factory address
}

export interface BridgeRequest {
  lockId: string;
  sender: string;
  amount: string;
  srcChainId: number;
  destChainId: number;
  destRecipient: string;
}

export interface RelayResult {
  success: boolean;
  transactionHash?: Hex;
  error?: string;
}

const CHAINS: Record<number, Chain> = {
  31337: hardhat,
  11155111: sepolia,
  421614: arbitrumSepolia,
  84532: baseSepolia,
};

const BRIDGE_ABI = [
  {
    name: "locks",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "lockId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "srcChainId", type: "uint256" },
      { name: "srcLockId", type: "bytes32" },
    ],
    outputs: [{ name: "mintId", type: "bytes32" }],
  },
] as const;

const ENTRYPOINT_ABI = [
  {
    name: "handleOps",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
] as const;

export function loadConfigFromEnv(): RelayerConfig {
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY as Hex;
  if (!relayerPrivateKey) {
    throw new Error("RELAYER_PRIVATE_KEY not set");
  }

  // Default public RPCs — no env vars needed
  const DEFAULT_RPCS: Record<number, string> = {
    31337: "http://127.0.0.1:8545",
    11155111: "https://ethereum-sepolia-rpc.publicnode.com",
    421614: "https://arbitrum-sepolia-rpc.publicnode.com",
    84532: "https://base-sepolia-rpc.publicnode.com",
  };

  const rpcUrls: Record<number, string> = {};
  const allowedChains = (process.env.ALLOWED_CHAINS ?? "31337,11155111,421614,84532")
    .split(",")
    .map(Number);

  for (const chainId of allowedChains) {
    rpcUrls[chainId] = process.env[`RPC_URL_${chainId}`] ?? DEFAULT_RPCS[chainId] ?? "";
  }

  // Read chain-specific addresses
  const bridgeAddresses: Record<number, string> = {};
  const paymasterAddresses: Record<number, string> = {};
  const factoryAddresses: Record<number, string> = {};
  for (const chainId of allowedChains) {
    const bridge = process.env[`BRIDGE_ADDRESS_${chainId}`];
    const paymaster = process.env[`PAYMASTER_ADDRESS_${chainId}`];
    const factory = process.env[`FACTORY_ADDRESS_${chainId}`];
    if (bridge) bridgeAddresses[chainId] = bridge;
    if (paymaster) paymasterAddresses[chainId] = paymaster;
    if (factory) factoryAddresses[chainId] = factory;
  }

  return {
    relayerPrivateKey,
    rpcUrls,
    entryPointAddress: (process.env.ENTRYPOINT_ADDRESS ??
      "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108") as Address,
    allowedChains,
    paymasterAddress: process.env.PAYMASTER_ADDRESS as Address | undefined,
    accountFactoryAddress: process.env.ACCOUNT_FACTORY_ADDRESS as Address | undefined,
    bridgeAddresses,
    paymasterAddresses,
    factoryAddresses,
  };
}

/**
 * Validate a UserOperation before relaying.
 * Checks basic structure — does NOT verify the signature (EntryPoint does that).
 */
export function validateUserOp(
  userOp: UserOperation,
  config: RelayerConfig,
  chainId?: number,
): string | null {
  if (!userOp.sender || !userOp.sender.startsWith("0x")) {
    return "Invalid sender address";
  }
  if (!userOp.signature || userOp.signature === "0x") {
    return "Missing signature";
  }
  if (!userOp.callData) {
    return "Missing callData";
  }

  // If paymaster is used, verify it's one of ours (per-chain or global)
  if (userOp.paymasterAndData && userOp.paymasterAndData !== "0x" && userOp.paymasterAndData.length >= 42) {
    const pmAddr = userOp.paymasterAndData.slice(0, 42).toLowerCase();

    // Check per-chain paymaster first, then global fallback
    const allowedPaymasters: string[] = [];
    if (chainId && config.paymasterAddresses[chainId]) {
      allowedPaymasters.push(config.paymasterAddresses[chainId].toLowerCase());
    }
    if (config.paymasterAddress) {
      allowedPaymasters.push(config.paymasterAddress.toLowerCase());
    }

    // If no paymaster configured, allow any (permissive mode)
    if (allowedPaymasters.length > 0 && !allowedPaymasters.includes(pmAddr)) {
      return `Unknown paymaster: ${pmAddr}. Allowed: ${allowedPaymasters.join(", ")}`;
    }
  }

  return null;
}

/**
 * Submit a signed UserOperation to the EntryPoint.
 * The relayer pays gas and gets reimbursed by the paymaster.
 */
export async function relayUserOp(
  userOp: UserOperation,
  chainId: number,
  config: RelayerConfig,
): Promise<RelayResult> {
  // Validate chain
  if (!config.allowedChains.includes(chainId)) {
    return { success: false, error: `Chain ${chainId} not supported` };
  }

  const rpcUrl = config.rpcUrls[chainId];
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for chain ${chainId}` };
  }

  // Validate UserOp
  const validationError = validateUserOp(userOp, config, chainId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const chain = CHAINS[chainId] ?? {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  const relayerAccount = privateKeyToAccount(config.relayerPrivateKey);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account: relayerAccount,
    chain,
    transport: http(rpcUrl),
  });

  try {
    // Convert hex strings to bigints for the contract call
    const formattedOp = {
      sender: userOp.sender,
      nonce: BigInt(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits: userOp.accountGasLimits,
      preVerificationGas: BigInt(userOp.preVerificationGas),
      gasFees: userOp.gasFees,
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature,
    };

    const hash = await walletClient.writeContract({
      address: config.entryPointAddress,
      abi: ENTRYPOINT_ABI,
      functionName: "handleOps",
      args: [[formattedOp], relayerAccount.address],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { success: true, transactionHash: hash };
  } catch (error: any) {
    let msg = error instanceof Error ? error.message : String(error);

    // Try to decode FailedOp reason from the revert data
    if (msg.includes("0x220266b6") || msg.includes("FailedOp")) {
      try {
        // Extract the revert data and decode
        const match = msg.match(/0x220266b6[0-9a-fA-F]*/);
        if (match) {
          const { decodeErrorResult } = await import("viem");
          const decoded = decodeErrorResult({
            abi: [{
              type: "error",
              name: "FailedOp",
              inputs: [
                { name: "opIndex", type: "uint256" },
                { name: "reason", type: "string" },
              ],
            }],
            data: match[0] as `0x${string}`,
          });
          msg = `FailedOp: ${decoded.args?.[1] ?? "unknown reason"}`;
        }
      } catch {
        // Keep original message if decoding fails
      }
    }

    console.error(`[relayer] handleOps error: ${msg.slice(0, 300)}`);
    return { success: false, error: msg.slice(0, 500) };
  }
}

/**
 * Relay a bridge lock: verify lock on source chain, then mint on destination chain.
 */
export async function relayBridge(
  request: BridgeRequest,
  config: RelayerConfig,
): Promise<RelayResult> {
  const { lockId, amount, srcChainId, destChainId, destRecipient } = request;

  if (!config.bridgeAddresses) {
    return { success: false, error: "Bridge addresses not configured" };
  }

  const srcBridgeAddr = config.bridgeAddresses[srcChainId];
  const destBridgeAddr = config.bridgeAddresses[destChainId];

  if (!srcBridgeAddr) {
    return { success: false, error: `No bridge address for source chain ${srcChainId}` };
  }
  if (!destBridgeAddr) {
    return { success: false, error: `No bridge address for dest chain ${destChainId}` };
  }

  const srcRpcUrl = config.rpcUrls[srcChainId];
  const destRpcUrl = config.rpcUrls[destChainId];

  if (!srcRpcUrl || !destRpcUrl) {
    return { success: false, error: "Missing RPC URL for source or destination chain" };
  }

  const srcChain = CHAINS[srcChainId] ?? {
    id: srcChainId,
    name: `chain-${srcChainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [srcRpcUrl] } },
  };

  const destChain = CHAINS[destChainId] ?? {
    id: destChainId,
    name: `chain-${destChainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [destRpcUrl] } },
  };

  const relayerAccount = privateKeyToAccount(config.relayerPrivateKey);

  // 1. Verify lock exists on source chain
  const srcPublicClient = createPublicClient({
    chain: srcChain,
    transport: http(srcRpcUrl),
  });

  try {
    const lockExists = await srcPublicClient.readContract({
      address: srcBridgeAddr as Address,
      abi: BRIDGE_ABI,
      functionName: "locks",
      args: [lockId as Hex],
    });

    if (!lockExists) {
      return { success: false, error: "Lock does not exist on source chain" };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to verify lock: ${msg.slice(0, 300)}` };
  }

  // 2. Mint on destination chain
  const destPublicClient = createPublicClient({
    chain: destChain,
    transport: http(destRpcUrl),
  });

  const destWalletClient = createWalletClient({
    account: relayerAccount,
    chain: destChain,
    transport: http(destRpcUrl),
  });

  try {
    const hash = await destWalletClient.writeContract({
      address: destBridgeAddr as Address,
      abi: BRIDGE_ABI,
      functionName: "mint",
      args: [
        destRecipient as Address,
        BigInt(amount),
        BigInt(srcChainId),
        lockId as Hex,
      ],
    });

    await destPublicClient.waitForTransactionReceipt({ hash });

    return { success: true, transactionHash: hash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to mint: ${msg.slice(0, 300)}` };
  }
}
