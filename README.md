# Z0tz Relayer

Serverless relayer for Z0tz — submits signed ERC-4337 UserOperations and cross-chain bridge transactions to the blockchain. Users never need ETH; the relayer pays gas and gets reimbursed by the Z0tzPaymaster.

Designed for Vercel deployment. Zero external dependencies.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/relay` | POST | Submit a signed UserOperation to the EntryPoint |
| `/bridge` | POST | Relay a cross-chain lock event → mint on destination |
| `/health` | GET | Relayer status, address, supported chains |
| `/config` | GET | Public contract addresses for CLI/GUI discovery |

## Deploy to Vercel

```bash
# 1. Clone
git clone git@github.com:0xOucan/Z0tzRelayer.git
cd Z0tzRelayer

# 2. Install
pnpm install

# 3. Configure environment variables in Vercel dashboard:
#    RELAYER_PRIVATE_KEY     — EOA that pays gas (gets reimbursed)
#    RPC_URL_11155111        — Sepolia RPC
#    RPC_URL_421614          — Arbitrum Sepolia RPC
#    RPC_URL_84532           — Base Sepolia RPC
#    ALLOWED_CHAINS          — 11155111,421614,84532
#    ENTRYPOINT_ADDRESS      — 0x0000000071727De22E5E9d8BAf0edAc6f37da032
#    PAYMASTER_ADDRESS       — (deployed Z0tzPaymaster address)
#    ACCOUNT_FACTORY_ADDRESS — (deployed Z0tzAccountFactory address)

# 4. Deploy
vercel deploy --prod
```

## How It Works

### UserOp Relay (`POST /relay`)

```json
{
  "userOp": {
    "sender": "0x...",
    "nonce": "0x0",
    "initCode": "0x",
    "callData": "0x...",
    "accountGasLimits": "0x...",
    "preVerificationGas": "0x...",
    "gasFees": "0x...",
    "paymasterAndData": "0x...",
    "signature": "0x..."
  },
  "chainId": 84532
}
```

The relayer:
1. Validates the UserOp structure
2. Calls `EntryPoint.handleOps()` using the relayer's EOA
3. EntryPoint validates the P-256 signature on the smart account
4. Z0tzPaymaster pays gas + collects 1% token fee
5. Returns the transaction hash

### Bridge Relay (`POST /bridge`)

```json
{
  "lockId": "0x...",
  "sender": "0x...",
  "amount": "1000000",
  "srcChainId": 11155111,
  "destChainId": 84532,
  "destRecipient": "0x..."
}
```

The relayer:
1. Verifies the lock exists on the source chain
2. Calls `Z0tzBridge.mint()` on the destination chain
3. Returns the mint transaction hash

## Security

- The relayer **cannot steal funds** — it only submits transactions that are pre-signed by the user's passkey
- The relayer **cannot modify transfers** — the UserOp signature covers all calldata
- The relayer **cannot read amounts** — FHE-encrypted values are opaque
- Rate limiting: 60 ops/minute per IP
- CORS enabled for CLI/GUI access

## Local Development

```bash
# Run locally (uses Hardhat node at localhost:8545)
cp .env.example .env
# Edit .env with your local config
vercel dev
```

## Future: P2P Relayer Network

Every Z0tz CLI/GUI user can become a relayer node:

```bash
z0tz node start --relayer-key 0x... --fee-share 50%
```

Nodes relay others' transactions, earn a share of the paymaster fee. Fully decentralized — no VPS, no Vercel, no single point of failure.

## License

Apache-2.0
