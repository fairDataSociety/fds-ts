# Changelog

All notable changes to `@fairdatasociety/fds` are documented in this file.

## [1.1.0] — 2026-04-30

### Added — subpath exports for direct consumers

These subpaths exist so Fairdrop and Fairdrive can migrate off their internal
workspace packages onto the consolidated SDK without rewriting against
`FdsClient`. Existing `FdsClient` API unchanged.

- `@fairdatasociety/fds/crypto` — BrowserCryptoProvider, NodeCryptoProvider,
  ECDH, encryptSwarmRef, AES-GCM, Web3 keystore primitives
- `@fairdatasociety/fds/identity` — Wallet, createKeystore, decryptKeystore,
  HDWallet (ported from `@fds/identity`)
- `@fairdatasociety/fds/access` — ACT (Access Control Trie)
- `@fairdatasociety/fds/fairdrive` — browser-safe Fairdrive primitives
  (PodManager, FileManager, ACT, WalletManager, SecureWallet, ChunkManager,
  FairdropKeystore)
- `@fairdatasociety/fds/fairdrive/node` — Node-only additions (SecureStore,
  SyncEngine) — bundlers should not include this in browser builds
- `@fairdatasociety/fds/fairdrop` — FairdropClient, GSOC primitives,
  EscrowKeystore, DataEscrowABI, Node providers (FileStorageAdapter,
  NodeCryptoProvider, EnvConfigProvider, NodeEncodingProvider), contract
  address resolution

### Verified

- Keystore backwards-compat: keystores encrypted with the old workspace
  `@fds/identity` decrypt cleanly on the new `/identity` subpath
- Fairdrive desktop (Wails) builds and launches
- Fairdrop UI builds (961 KB / 324 KB gz, +0.6% over pre-migration)
- Fairdrop MCP starts via stdio with 24 tools registered

## [1.0.0] — 2026-04-30

### Complete rewrite

This is a **complete rewrite** of the `@fairdatasociety/fds` package. It is **not backwards-compatible** with versions ≤ 0.2.3 published from the legacy [`fds.js`](https://github.com/fairDataSociety/fds.js) repo (last updated February 2022, abandoned).

The new SDK ships from [`fairDataSociety/fds-ts`](https://github.com/fairDataSociety/fds-ts) and consolidates working primitives from Fairdrop and Fairdrive into a single namespaced client.

If you were relying on `@fairdatasociety/fds@0.2.x` from `fds.js`, pin to that exact version. The 1.x line shares the npm name but is otherwise an independent project.

### New API

```typescript
import { FdsClient } from '@fairdatasociety/fds'

const fds = new FdsClient({
  storage: { type: 'swarm', beeUrl: 'http://localhost:1633', batchId: '...' },
  chain: { rpcUrl: '...', chainId: 11155111, escrowContract: '0x...' },
})
await fds.init()
await fds.identity.create()
```

Namespaced services:

| Service | Capabilities |
|---------|--------------|
| `fds.identity` | HD wallet, sign, ENS resolution, keystore backup/restore |
| `fds.storage` | S3-like put/get/list/delete with AES-256-GCM by default |
| `fds.transfer` | ECDH-encrypted send + GSOC inbox receive |
| `fds.sharing` | Per-grantee ACT (Access Control Trie) grants + revocation |
| `fds.escrow` | DataEscrow contract: create/fund/commit/reveal/claim/dispute |
| `fds.publish` | Unencrypted `/bzz` upload for public data |
| `fds.stamps` | Postage stamp status, topup, dilute, buy |

Flat shortcuts (`fds.put`, `fds.get`, `fds.send`, `fds.publish`) for the common path.

### Backends

- **Local** — filesystem-backed adapter, encrypted at rest
- **Swarm** — Ethereum Swarm via `@ethersphere/bee-js@11`
- (Adapter interface allows custom backends)

### Cross-platform interop

- Pod key derivation `keccak256(privateKeyHex:pod:podName)` matches Go [`fds-id-go`](https://github.com/fairDataSociety/fds-id-go) test vectors.
- Wallet derivation path `m/44'/60'/0'/0/0` matches Go default.
- Web3 v3 keystore export/import (MetaMask compatible).

### What's included

- 342 tests passing — 333 unit + 9 integration against real Bee node and Sepolia RPC
- TypeScript-first with full `.d.ts` exports
- CLI (`fds`) and MCP server (`fds-mcp`) bundled

### Sources

Primitives ported from working production code:
- GSOC inbox messaging — [`fairdrop`](https://github.com/fairDataSociety/fairdrop)
- ACT access control + WalletManager + FileManager + PodManager — [`fairdrive`](https://github.com/fairDataSociety/fairdrive)
- DataEscrow contract integration — `fairdrop` SDK
- Identity / keystore — [`fds-id-ts`](https://github.com/fairDataSociety/fds-id-ts)

### Migration from legacy fds.js

Not applicable — this is a new SDK with a different API. Treat 1.0.0 as a fresh dependency. The legacy `FDS` class with `signup()` / `login()` / `getMail()` does not exist here; use `FdsClient` with `identity.create()` / `transfer.send()` / `transfer.receive()`.

[1.0.0]: https://github.com/fairDataSociety/fds-ts/releases/tag/v1.0.0
