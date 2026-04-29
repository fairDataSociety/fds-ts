# @fairdatasociety/fds

> Sovereign data SDK for TypeScript — identity, storage, messaging, sharing, and trustless exchange. Encryption by default. Pluggable backends.

[![License: BSD-3](https://img.shields.io/badge/license-BSD--3-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-146_passing-green)]()
[![Status](https://img.shields.io/badge/status-alpha-orange)]()

## What it does

One client. Three things you can do with sovereign data:

```typescript
import { FdsClient } from '@fairdatasociety/fds'

const fds = new FdsClient({ storage: { type: 'local', path: '~/.fds' } })
await fds.init()

// 1. Own your data — encrypted by default
await fds.identity.create()
await fds.put('documents/contract.pdf', myFile)
const file = await fds.get('documents/contract.pdf')

// 2. Send privately — ECDH encrypted, only recipient can read
await fds.send(alicePubKey, myFile, { filename: 'confidential.pdf' })

// 3. Sell trustlessly — escrow-backed exchange
const escrow = await fds.escrow.create('datasets/users.csv', { price: '0.01' })
```

Everything is encrypted with keys derived from your wallet. The storage backend never sees plaintext.

## Install

```bash
npm install @fairdatasociety/fds
```

## API surface

```
fds.identity    create, import, sign, lock, keystore, derive child accounts
fds.storage     S3-like: put / get / list / delete / head / move / copy
fds.transfer    send (ECDH), receive, subscribe (inbox)
fds.sharing     grant / revoke / list / hasAccess (ACT)
fds.escrow      create / status / claim / dispute / recoverKeys
fds.publish     unencrypted public storage on Swarm
fds.stamps      postage stamp management

// Flat shortcuts for the 80% case
fds.put / fds.get / fds.list / fds.delete / fds.send / fds.publish
```

## CLI

```bash
npx @fairdatasociety/fds init               # create identity
npx @fairdatasociety/fds put docs/a.txt -   # store from stdin
npx @fairdatasociety/fds get docs/a.txt     # retrieve
npx @fairdatasociety/fds send 0x... file.txt # encrypted send
npx @fairdatasociety/fds sell data/x.csv --price 0.01
```

Or install globally and use `fds`:

```bash
npm install -g @fairdatasociety/fds
fds init
fds status --json
```

## MCP server (for AI agents)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "fds": { "command": "npx", "args": ["fds-mcp"] }
  }
}
```

15 tools exposed: `fds_status`, `fds_create_identity`, `fds_put`, `fds_get`,
`fds_list`, `fds_delete`, `fds_send`, `fds_receive`, `fds_share`, `fds_revoke`,
`fds_grantees`, `fds_sell`, `fds_escrow_status`, `fds_publish`, `fds_import_identity`.

## Storage backends

Pluggable via the `StorageAdapter` interface. Encryption sits *above* the adapter,
so every backend gets client-side encryption automatically.

```typescript
// Local filesystem (current — for desktop, dev, mobile-Node)
new FdsClient({ storage: { type: 'local', path: '~/.fds' } })

// Swarm (in-progress — for fully decentralized storage)
new FdsClient({ storage: { type: 'swarm', beeUrl: 'http://localhost:1633', batchId: '...' } })
```

## Architecture

```
Application
    ↓
FdsClient (namespaces + flat shortcuts)
    ↓
Services (identity, storage, transfer, sharing, escrow, publish, stamps)
    ↓
Encryption layer (AES-256-GCM, ECDH, HKDF — keys never leave client)
    ↓
StorageAdapter (Local, Swarm, future: S3/IPFS)
```

Key derivation: `wallet privkey → keccak256(privkey + ":pod:" + bucket) → PBKDF2(podKey, "fairdrive:v1:{bucket}:{path}", 100000)`. Matches the Go reference implementation in `fds-id-go` for cross-platform interop.

## Security

- **Encryption by default.** All `put` operations encrypted client-side. `publish` is the explicit unencrypted opt-out.
- **Per-file keys.** Compromising one file doesn't expose others.
- **Forward secrecy on send.** Each `send()` uses a fresh ephemeral keypair.
- **HKDF with domain separation.** Send uses `"fds-send-v1"` salt to prevent cross-protocol key reuse.
- **Audited.** [SPEC.md](./SPEC.md) lists 16 security findings from a dual Claude+Codex review (S1-S16). 14 are addressed in code or documented.

Known limitations (see SPEC.md for details):
- ACT revocation is metadata-only on Swarm — old refs may still decrypt. Use `rotateAccess` for true revocation.
- "Anonymous" send is application-layer only — Bee operator still sees uploads.
- Adapter sees bucket and key names in plaintext (file *content* is encrypted).

## Testing

```bash
npm test                        # 146 unit + integration tests
npm run typecheck               # TypeScript strict mode
```

Test categories:
- `test/unit/`           — Pure unit tests (no I/O)
- `test/integration/`    — End-to-end flows on local adapter
- `test/stress/`         — Concurrency and load
- `test/integration/sepolia-*` — Sepolia + Bee tests (skip gracefully without env)

To run Sepolia tests:

```bash
FDS_TEST_BEE_URL=http://localhost:1633 \
FDS_TEST_BATCH_ID=<batch-id> \
FDS_TEST_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
npm test
```

## Repo structure

```
src/
  client.ts              FdsClient composition root
  types.ts errors.ts     shared types and FdsError
  crypto/
    keys.ts              pod and file key derivation
    encryption.ts        AES-256-GCM
    ecdh.ts              ECDH + HKDF for send/receive
  services/
    identity.ts          wallet + keystore + signing
    storage.ts           encryption layer + adapter dispatch
    transfer.ts          send/receive via ECDH + inbox
    sharing.ts           ACT grants
    escrow.ts            trustless data exchange
    publish.ts           unencrypted public uploads
    stamps.ts            postage stamps
  adapters/
    interface.ts         StorageAdapter contract
    local.ts             filesystem adapter
    swarm.ts             Swarm adapter (wraps PodManager + FileManager)
  cli/                   fds command
  mcp/                   fds-mcp server (15 tools)
test/
  unit/                  146 unit tests
  integration/           CLI flows, multi-identity, Sepolia
  stress/                concurrency, large files
SPEC.md                  full specification + security audit
```

## License

BSD-3-Clause. © Fair Data Society.
