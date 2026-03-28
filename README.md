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

## Quick Start

### 1. Deploy Z0tz contracts (auto-fills relayer .env)

```bash
# In the Z0tz repo — deploy to each chain
cd contracts
KEYSTORE_PASSPHRASE=**** RELAYER_ADDRESS=0xYourRelayerEOA \
  npx hardhat run tasks/deploy-all.ts --network eth-sepolia
KEYSTORE_PASSPHRASE=**** RELAYER_ADDRESS=0xYourRelayerEOA \
  npx hardhat run tasks/deploy-all.ts --network arb-sepolia
KEYSTORE_PASSPHRASE=**** RELAYER_ADDRESS=0xYourRelayerEOA \
  npx hardhat run tasks/deploy-all.ts --network base-sepolia
# → relayer/.env auto-filled with per-chain contract addresses
```

### 2. Local testing

```bash
pnpm install
vercel dev    # starts on http://localhost:3000
# .env was auto-filled by deploy-all.ts
```

### 3. Deploy to Vercel

```bash
# Set RELAYER_PRIVATE_KEY in Vercel dashboard
# All other vars are in .env (auto-filled)
vercel deploy --prod
```

## Environment Variables

**Only `RELAYER_PRIVATE_KEY` is required.** Everything else has defaults or is auto-filled by the deployment wizard.

```bash
# Required
RELAYER_PRIVATE_KEY=0x...     # EOA that pays gas (gets reimbursed)

# Per-chain addresses (auto-filled by deploy-all.ts)
PAYMASTER_ADDRESS_11155111=0x...   # Eth Sepolia paymaster
FACTORY_ADDRESS_11155111=0x...     # Eth Sepolia factory
BRIDGE_ADDRESS_11155111=0x...      # Eth Sepolia bridge
TOKEN_ADDRESS_11155111=0x...       # Eth Sepolia token

PAYMASTER_ADDRESS_421614=0x...     # Arb Sepolia
FACTORY_ADDRESS_421614=0x...
BRIDGE_ADDRESS_421614=0x...
TOKEN_ADDRESS_421614=0x...

PAYMASTER_ADDRESS_84532=0x...      # Base Sepolia
FACTORY_ADDRESS_84532=0x...
BRIDGE_ADDRESS_84532=0x...
TOKEN_ADDRESS_84532=0x...

# Optional (defaults to publicnode.com)
# RPC_URL_11155111=https://...
# RPC_URL_421614=https://...
# RPC_URL_84532=https://...
```

## How It Works

### UserOp Relay (`POST /relay`)

```json
{
  "userOp": { "sender": "0x...", "nonce": "0x0", "callData": "0x...", "signature": "0x...", "..." },
  "chainId": 84532
}
```

1. Validates UserOp structure
2. Calls `EntryPoint.handleOps()` using relayer's EOA
3. EntryPoint validates P-256 signature on the smart account
4. Z0tzPaymaster pays gas + collects 1% token fee
5. Returns transaction hash

### Bridge Relay (`POST /bridge`)

```json
{
  "lockId": "0x...", "sender": "0x...", "amount": "1000000",
  "srcChainId": 11155111, "destChainId": 84532, "destRecipient": "0x..."
}
```

1. Verifies lock exists on source chain
2. Calls `Z0tzBridge.mint()` on destination chain
3. Returns mint transaction hash

## Security

- The relayer **cannot steal funds** — it only submits pre-signed transactions
- The relayer **cannot modify transfers** — UserOp signature covers all calldata
- The relayer **cannot read amounts** — FHE-encrypted values are opaque
- **Paymaster hardened** — only sponsors Z0tz accounts + approved contract targets
- **Per-chain isolation** — separate paymaster, factory, bridge per chain
- Rate limiting: 60 ops/minute per IP
- CORS enabled for CLI/GUI access

## Architecture

```
Each chain has its own contracts:

Eth Sepolia (11155111)     Arb Sepolia (421614)      Base Sepolia (84532)
├── Z0tzPaymaster          ├── Z0tzPaymaster          ├── Z0tzPaymaster
├── Z0tzAccountFactory     ├── Z0tzAccountFactory     ├── Z0tzAccountFactory
├── Z0tzToken              ├── Z0tzToken              ├── Z0tzToken
├── Z0tzBridge             ├── Z0tzBridge             ├── Z0tzBridge
├── StealthRegistry        ├── StealthRegistry        ├── StealthRegistry
├── StealthAnnouncer       ├── StealthAnnouncer       ├── StealthAnnouncer
└── StealthSweeper         └── StealthSweeper         └── StealthSweeper

                    ┌───────────────────┐
                    │   Z0tz Relayer    │
                    │  (this service)   │
                    │                   │
                    │ RELAYER_PRIVATE_KEY│
                    │ reads per-chain   │
                    │ contract addresses│
                    └───────────────────┘
```

## Future: P2P Relayer Network

Every Z0tz CLI/GUI user can become a relayer node:

```bash
z0tz node start --relayer-key 0x... --fee-share 50%
```

Nodes relay others' transactions, earn a share of the paymaster fee. Fully decentralized — no VPS, no Vercel, no single point of failure.

## License

Apache-2.0
