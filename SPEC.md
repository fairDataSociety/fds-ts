# @fairdatasociety/fds — SDK Specification v6

**Date**: 2026-04-29
**Status**: Draft — pending security audit

## Principles

1. **Security and privacy are the foundation**, not features. Every operation is encrypted by default. Publishing (unencrypted) is the explicit opt-out.
2. **Keys never leave the client.** All signing, encryption, and key derivation happen locally. No server ever sees private keys.
3. **Storage-agnostic.** Swarm is the default backend. Any storage can plug in via the adapter interface. Encryption sits above the adapter — all backends get client-side encryption.
4. **One import, one client, namespaced services.** Firebase/Supabase pattern. Identity auto-propagates.
5. **S3-like storage.** Buckets + objects. put/get/list/delete. Developers know this pattern.
6. **TDD.** Every feature has tests before implementation. Unit, integration, smoke, stress.

---

## Client

```typescript
import { FdsClient } from '@fairdatasociety/fds'

const fds = new FdsClient({
  storage: { type: 'swarm', beeUrl: 'http://localhost:1633', batchId: '...' },
  chain: { rpcUrl: 'https://mainnet.base.org', chainId: 8453 },
})
await fds.init()
```

### Namespaces

```
fds.identity    — wallet, keys, ENS, SIWE, signing, backup
fds.storage     — put, get, list, delete, head, move, copy (S3-like)
fds.transfer    — send, receive, subscribe (encrypted messaging)
fds.sharing     — share, accept, revoke, grantees (ACT)
fds.escrow      — sell, buy, claim, dispute (trustless exchange)
fds.publish     — public (unencrypted) data
fds.stamps      — postage stamp management
fds.status()    — aggregated health check
```

### Flat Shortcuts

```typescript
fds.put(key, data)       → fds.storage.put(key, data)
fds.get(key)             → fds.storage.get(key)
fds.list(prefix?)        → fds.storage.list(prefix)
fds.delete(key)          → fds.storage.delete(key)
fds.send(to, data, opts) → fds.transfer.send(to, data, opts)
fds.publish(data, opts)  → fds.publish.upload(data, opts)
```

---

## 1. Identity (`fds.identity`)

Account creation = wallet + default buckets (data, inbox) + GSOC inbox registration.

### Create & Import

```typescript
// Create new account (HD wallet + default buckets + inbox)
const id = await fds.identity.create()
// → { address, publicKey, mnemonic } — mnemonic returned ONCE

// Create with password protection (SecureWallet — PBKDF2 100k, keys zeroed after use)
const id = await fds.identity.create({ password: 'strong' })

// Create with 24-word mnemonic
const id = await fds.identity.create({ wordCount: 24 })

// Register with ENS subdomain (Fairdrop-style account)
const id = await fds.identity.register('alice', 'password')
// Side effects: wallet + default buckets + inbox + GSOC params + ENS text records

// Import from mnemonic
const id = await fds.identity.import('twelve word mnemonic ...')
const id = await fds.identity.import('twelve word mnemonic ...', { password: '...' })

// Import from private key
const id = await fds.identity.importKey('0xabc...')

// Get current identity
fds.identity.current  // → { address, publicKey, ensName? } | null
```

**Side effects of create/register:**
1. Generate HD wallet (BIP-44 path `m/44'/60'/0'/0/0`)
2. Create "data" bucket (default storage)
3. Create "inbox" bucket (incoming messages)
4. Register GSOC inbox params
5. Set ENS text records (if register with subdomain)

**Mnemonic handling:** Returned once from `create()`. SDK strips from internal state immediately. JS cannot guarantee hard zeroization (GC limitation). Use SecureWallet (`{ password }`) for production — PBKDF2 derives key on demand, zeros after each use.

### Wallet Operations

```typescript
// Lock / unlock (prevents key access)
await fds.identity.lock()
await fds.identity.unlock('password')
fds.identity.isLocked  // → boolean

// Sign (EIP-191 personal_sign)
const sig = await fds.identity.sign('message')

// Sign typed data (EIP-712)
const sig = await fds.identity.signTypedData(domain, types, value)

// Verify message signature
const valid = await fds.identity.verify('message', signature, address)

// Derive child account (BIP-44 multi-account)
const child = await fds.identity.deriveChild(1)
// → { address, publicKey }
```

### ENS

```typescript
// Resolve ENS name → address + public key + inbox params
const info = await fds.identity.resolve('alice.fairdata.eth')
// → { address, publicKey?, inboxParams? }

// Reverse resolve address → ENS name
const name = await fds.identity.reverseLookup('0x1234...')

// Get shareable inbox link
const link = fds.identity.inboxLink()
// → 'fairdrop://inbox/{id}?pk={publicKey}'
```

### SIWE (Sign In With Ethereum)

```typescript
// Create SIWE message
const msg = fds.identity.siwe.create({ domain: 'example.com', uri: 'https://example.com' })

// Format for display and sign
const formatted = fds.identity.siwe.format(msg)
const sig = await fds.identity.sign(formatted)

// Verify (server-side or client-side)
const result = fds.identity.siwe.verify(formatted, sig, { domain: 'example.com' })
// → { valid, address?, error? }
```

### Keystore

```typescript
// Export as Web3 v3 (MetaMask compatible)
const ks = await fds.identity.exportKeystore('password')

// Import Web3 v3 keystore
const id = await fds.identity.importKeystore(ks, 'password')

// FDS keystore format (Fairdrop/Fairdrive compatible, includes full account)
const fdsKs = await fds.identity.exportFdsKeystore('password')
const id = await fds.identity.importFdsKeystore(fdsKs, 'password')
```

### Backup & Recovery

```typescript
// Backup (encrypt keystore + pod list → Swarm → ENS text record)
const ref = await fds.identity.backup('backup-password')
// → { reference, ensRecord: 'eth.fairdata.backup' }

// Restore from ENS name + password
await fds.identity.restore('alice.fairdata.eth', 'backup-password')

// Restore from Swarm reference
await fds.identity.restore(swarmRef, 'backup-password')

// Check if backup exists
const exists = await fds.identity.backupExists('alice.fairdata.eth')
```

### Secure Store (Desktop)

```typescript
// OS keychain integration (macOS Keychain, Windows Cred Mgr, Linux Secret Service)
// Fallback to encrypted file with explicit passphrase (not machine-derived)
await fds.identity.secureStore.save(walletData)
const wallet = await fds.identity.secureStore.load(address)
const addrs = await fds.identity.secureStore.list()
await fds.identity.secureStore.delete(address)
```

---

## 2. Storage (`fds.storage`)

S3-like. Buckets = pods. Objects = encrypted files. All encrypted at rest by default.

### Objects

```typescript
// Put (string | Buffer | Uint8Array — auto-coerced)
await fds.put('documents/report.pdf', pdfBuffer)
await fds.put('docs/note.txt', 'plain text')
await fds.put('docs/img.jpg', data, { contentType: 'image/jpeg' })
await fds.put('docs/report.pdf', data, { onConflict: 'rename' })

// Get
const data = await fds.get('documents/report.pdf')  // → Uint8Array

// Head (metadata only)
const meta = await fds.storage.head('documents/report.pdf')
// → { key, size, contentType, createdAt, modifiedAt, encrypted, reference? }

// Exists
const exists = await fds.storage.exists('documents/report.pdf')

// List (S3 ListObjectsV2 style)
const result = await fds.list('documents/')
// → { objects: [{ key, size, lastModified }], prefixes: ['documents/drafts/'] }

// List all (recursive)
const all = await fds.list('documents/', { recursive: true })

// Delete
await fds.delete('documents/old.pdf')

// Move / Rename
await fds.storage.move('docs/draft.pdf', 'docs/final.pdf')

// Copy (cross-bucket supported)
await fds.storage.copy('docs/report.pdf', 'archive/report-2026.pdf')

// Mkdir
await fds.storage.mkdir('documents/drafts')
```

### Buckets

```typescript
await fds.storage.createBucket('research')
const buckets = await fds.storage.listBuckets()
// → [{ name, createdAt, isShared }]
await fds.storage.deleteBucket('research')  // must be empty
await fds.storage.bucketExists('research')
```

**Large files:** ChunkManager splits >4MB transparently. Parallel upload/download, hash verification. Progress callback:
```typescript
await fds.put('data/large.zip', data, {
  onProgress: ({ percent, uploadedBytes, totalBytes }) => { ... }
})
```

**Encryption:** Per-file key derived from pod key + pod name + file path via PBKDF2 (100k iterations). AES-256-GCM with 12-byte IV. Auth tag verified on download. Key derivation matches Go fds-id-go for cross-platform interop.

---

## 3. Publish (`fds.publish`)

Public, unencrypted data on Swarm. The explicit opt-out from encryption-by-default.

```typescript
const ref = await fds.publish(data, { filename: 'paper.pdf' })
// → { reference, url }

// Publish directory (website)
const ref = await fds.publish(entries, { directory: true })

// Batch publish
const refs = await fds.publish.batch([file1, file2, file3])
```

---

## 4. Transfer (`fds.transfer`)

Encrypted one-off messaging. Send = encrypt for recipient + upload + notify inbox.

### Send

```typescript
// Send to ENS name (resolves pubkey, encrypts ECDH, notifies inbox)
await fds.send('alice.fairdata.eth', data, { filename: 'report.pdf', note: 'Q4' })

// Send to public key directly
await fds.send('0x04abcd...', data, { filename: 'msg.txt' })

// Anonymous send (sender identity not attached)
await fds.send('alice.eth', data, { anonymous: true })
```

**Under the hood:**
1. Resolve recipient → get public key + inbox GSOC params
2. Generate ephemeral keypair
3. ECDH shared secret (ephemeral + recipient pubkey)
4. AES-256-GCM encrypt with shared secret
5. Upload encrypted blob to Swarm
6. Write notification to recipient's inbox via GSOC SOC

### Receive

```typescript
// Poll inbox
const messages = await fds.transfer.receive()
// → [{ sender?, filename, reference, timestamp, size, type }]
// type: 'message' | 'share' | 'purchase'

// Read message content (auto-decrypts)
const data = await fds.get(messages[0].reference)

// Subscribe to real-time updates (WebSocket → polling fallback)
const sub = fds.transfer.subscribe((msg) => { ... })
sub.unsubscribe()
```

**Inbox is a pod.** The "inbox" bucket is created on account creation. All incoming content lands here: messages, share invitations, escrow receipts.

**Sender field is unauthenticated.** GSOC messages include a `sender` field but it's not cryptographically verified. Treat as a hint, not proof of identity. Future: signed inbox payloads.

---

## 5. Sharing (`fds.sharing`)

Collaborative pod access via ACT (Access Control Trie). Grantees can read AND write. Cryptographic access control, not server-based.

### Grant & Accept

```typescript
// Share a bucket (pod) — grant read+write access
await fds.sharing.grant('research', 'alice.fairdata.eth')

// Share a single file
await fds.sharing.grantFile('docs/report.pdf', 'alice.fairdata.eth')

// Accept a shared bucket (from share invitation in inbox)
await fds.sharing.accept(shareReference, { localName: 'alice-research' })

// Accept a shared file (save to target location)
await fds.sharing.acceptFile(shareReference, 'docs/received-report.pdf')
```

### Manage

```typescript
// List grantees
const grantees = await fds.sharing.list('research')
// → [{ address, publicKey, grantedAt, expiresAt? }]

// Revoke access
await fds.sharing.revoke('research', 'bob.fairdata.eth')

// Check access
const has = await fds.sharing.hasAccess('research', 'bob.eth')

// Rotate access (TRUE revocation — re-encrypts all content under new DEK)
await fds.sharing.rotateAccess('research')
// Expensive: re-uploads all content. But cryptographically revokes old grants.
```

### ACT Implementation Notes

**Two ACT layers exist in the underlying code:**

1. **Fairdrive ACT** (metadata-based): ECDH + HKDF + AES-256-GCM encrypted DEK grants. Signed metadata (v2+). Audit log. Used for pod/file sharing.
2. **Fairdrop ACT** (Bee-native): Uses Bee's built-in grantees API. Simpler but less flexible.

The SDK unifies these. Pod/file sharing uses Fairdrive ACT (richer, signed, auditable). Raw content sharing (publishProtected) can use Bee-native ACT for simplicity.

**Revocation limitation:** ACT revocation removes the grant from metadata, but old Swarm references are immutable. A revoked user who cached the old ACT metadata + encrypted DEK can still decrypt content. `rotateAccess()` is the only true revocation — it re-encrypts under a new DEK. Document this clearly.

---

## 6. Exchange (`fds.escrow`)

Trustless data commerce. Seller lists, buyer pays, smart contract (DataEscrow on Base chain) enforces fairness. Commit-reveal scheme prevents frontrunning.

### Sell

```typescript
const escrow = await fds.escrow.create('datasets/users.csv', {
  price: '0.01',                  // ETH
  description: 'User dataset',
  expiryDays: 30,
})
// → { escrowId, reference, contentHash, status: 'Created' }
// Data encrypted, uploaded to Swarm, escrow created on-chain.

// Deterministic key derivation (for skill exchange — same key from same data)
const escrow = await fds.escrow.create('skills/pack.json', { deterministic: true })
```

### Buy

```typescript
const details = await fds.escrow.status(escrowId)
const rep = await fds.escrow.reputation(escrowId)
const data = await fds.escrow.buy(escrowId)
// Funds escrow → waits for key reveal → decrypts → returns data
// Receipt written to buyer's inbox
```

### Lifecycle

```typescript
await fds.escrow.claim(id)            // seller claims payment
await fds.escrow.dispute(id)          // buyer disputes (5% bond)
await fds.escrow.claimExpired(id)     // buyer refund on expired escrow
```

### Recovery

```typescript
const keys = await fds.escrow.recoverKeys(id, 'password')
const stored = await fds.escrow.listKeys()
await fds.escrow.deleteKey(id)
```

### Keyless Gateway (unsigned transactions)

```typescript
const unsignedTx = await fds.escrow.prepare.create(data, metadata, opts)
const unsignedTx = await fds.escrow.prepare.fund(id)
const unsignedTx = await fds.escrow.prepare.claim(id)
const unsignedTx = await fds.escrow.prepare.dispute(id)
// ... sign client-side, submit via fds.escrow.submit(signedTx)
```

### Escrow States (from DataEscrow contract)

Created → Funded → KeyCommitted → Released → Claimed.
Also: Expired, Cancelled, Disputed, SellerResponded, ResolvedBuyer, ResolvedSeller.

**Commit-reveal scheme:**
1. Seller commits `keccak256(encryptedKeyForBuyer || salt)` on-chain
2. Mandatory delay: `MIN_BLOCK_DELAY` (2 blocks) + `MIN_TIME_DELAY` (60s)
3. Seller reveals encrypted key + salt
4. Buyer decrypts with ECDH (buyer privkey + seller ephemeral pubkey)
5. Contract verifies reveal matches commitment

**Known limitation (from codex audit):** Contract commits to hash of encrypted key, NOT to buyer's public key. Seller could encrypt to wrong key, forcing dispute. Fix requires contract upgrade to bind buyer pubkey on-chain at funding time.

---

## 7. Stamps (`fds.stamps`)

```typescript
const info = await fds.stamps.status()
// → { available, batchId?, balance?, ttl?, canUpload }

await fds.stamps.assign('batch-id')
const usable = await fds.stamps.getUsable()
await fds.stamps.topup('batch-id', amount)
```

Auto-managed by `fds.put()`: checks stamps before upload. If none available, errors with recovery action.

---

## 8. Status

```typescript
const s = await fds.status()
// → {
//   identity: { address?, ensName?, locked, connected },
//   storage: { type: 'swarm', connected },
//   stamps: { available, ttl? },
//   inbox: { unread },
//   chain: { chainId?, connected },
// }
```

---

## Storage Adapter Interface

The pluggable boundary. Operates on raw bytes. Knows nothing about encryption, identity, or ACT.

```typescript
interface StorageAdapter {
  readonly name: string
  readonly capabilities: AdapterCapabilities

  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): Promise<boolean>

  // Objects
  put(bucket: string, key: string, data: Uint8Array, opts?: PutOptions): Promise<PutResult>
  get(bucket: string, key: string): Promise<Uint8Array>
  head(bucket: string, key: string): Promise<ObjectMeta | null>
  delete(bucket: string, key: string): Promise<void>
  list(bucket: string, prefix?: string): Promise<ListResult>
  exists(bucket: string, key: string): Promise<boolean>
  move(bucket: string, from: string, to: string): Promise<void>

  // Buckets
  createBucket(name: string): Promise<void>
  listBuckets(): Promise<BucketInfo[]>
  deleteBucket(name: string): Promise<void>
  bucketExists(name: string): Promise<boolean>
}

interface AdapterCapabilities {
  nativeEncryption: boolean       // Swarm pods = true
  nativeSharing: boolean          // Swarm ACT = true
  versioning: boolean
  streaming: boolean
  publicUrls: boolean
  contentAddressed: boolean
  maxObjectSize?: number
}
```

**Shipped adapters:** SwarmAdapter (default), LocalAdapter (dev/desktop).
**Future:** S3Adapter, IPFSAdapter.

---

## Encryption Architecture

```
┌─────────────────────────────────────────┐
│  Application (fds.put / fds.send / ...) │
├─────────────────────────────────────────┤
│  Service Layer (StorageService, etc.)   │
├─────────────────────────────────────────┤
│  Encryption Layer                       │  ← encrypts/decrypts HERE
│  AES-256-GCM + PBKDF2 key derivation   │
│  Per-file key: PBKDF2(podKey, salt, 100k)│
│  Pod key: keccak256(privKey + podName)  │
├─────────────────────────────────────────┤
│  StorageAdapter (raw bytes)             │  ← adapter sees only ciphertext
└─────────────────────────────────────────┘
```

**Key derivation chain:**
1. Wallet private key (from HD wallet or mnemonic)
2. Pod key: `keccak256(privateKeyHex + ":pod:" + podName)` — matches Go fds-id-go
3. File key: `PBKDF2(podKey, salt="fairdrive:v1:{podName}:{filePath}", 100000, SHA-256)` → 32 bytes
4. File encryption: `AES-256-GCM(fileKey, randomIV(12))` → `IV(12) || authTag(16) || ciphertext`

**The adapter never sees plaintext.** Even a compromised adapter can't read stored data.

### Encryption per operation

| Operation | Encryption | Key source |
|-----------|-----------|-----------|
| `put()` | AES-256-GCM with per-file key | Pod key → PBKDF2 |
| `get()` | Decrypt with same key derivation | Pod key → PBKDF2 |
| `publish()` | NONE (explicit unencrypted) | — |
| `send()` | ECDH (ephemeral + recipient pubkey) → AES-256-GCM | Ephemeral keypair |
| `sharing.grant()` | DEK encrypted per-grantee via ECDH+HKDF | Owner + grantee keys |
| `escrow.create()` | AES-256-GCM with random key, key committed on-chain | Random or deterministic |

### Crypto libraries

All crypto uses `@noble` (audited, no native deps):
- `@noble/secp256k1` — ECDH, key generation, signatures
- `@noble/ciphers` — AES-256-GCM
- `@noble/hashes` — SHA-256, keccak256, PBKDF2, HKDF
- `@scure/bip39` + `@scure/bip32` — mnemonic + HD wallet (via fds-id)

No Node.js `crypto` module in the core encryption path. Isomorphic (Node + browser).

---

## Error Handling

Every error has `code` + `recovery`.

```typescript
class FdsError extends Error {
  code: FdsErrorCode
  recovery: string
  cause?: Error
}
```

| Code | When | Recovery |
|------|------|----------|
| `NO_IDENTITY` | No identity set | `fds.identity.create()` or `.import()` |
| `IDENTITY_LOCKED` | Wallet locked | `fds.identity.unlock(password)` |
| `NO_STORAGE` | Adapter not connected | Check config, `fds.status()` |
| `NO_STAMP` | No postage stamps | `fds.stamps.assign()` or use gateway |
| `STAMP_EXPIRED` | Stamp TTL ran out | Top up or new stamp |
| `BUCKET_NOT_FOUND` | Pod doesn't exist | `fds.storage.createBucket()` or `put()` auto-creates |
| `BUCKET_EXISTS` | Pod already exists | Use existing or choose another name |
| `BUCKET_NOT_EMPTY` | Can't delete non-empty | Delete contents first |
| `OBJECT_NOT_FOUND` | File doesn't exist | Check with `fds.list()` |
| `ENS_NOT_FOUND` | ENS name doesn't resolve | Verify name or use address/pubkey |
| `RECIPIENT_NO_PUBKEY` | No public key found | Recipient needs to register |
| `ACT_DENIED` | No access | Request access from owner |
| `ESCROW_WRONG_STATE` | Invalid escrow op | Check `fds.escrow.status()` |
| `ESCROW_EXPIRED` | Escrow expired | Buyer: `claimExpired()`. Seller: new escrow. |
| `CHAIN_UNREACHABLE` | RPC down | Check config |
| `ADAPTER_UNSUPPORTED` | Op not supported by adapter | Check capabilities |
| `FILE_TOO_LARGE` | Exceeds limit | ChunkManager handles most; check adapter |
| `INVALID_INPUT` | Bad parameters | Check docs |
| `INVALID_PASSWORD` | Wrong password | Re-enter password |

---

## Security Properties

### By design

1. **Client-side encryption only.** No server sees plaintext. No server sees keys.
2. **Encryption by default.** All `put()` data encrypted. `publish()` is explicit opt-out.
3. **Per-file key derivation.** Each file has its own key via PBKDF2 (100k iterations). Compromising one file key doesn't expose others.
4. **Ephemeral keys for sends.** Each `send()` generates a new keypair. Forward secrecy for messaging.
5. **Authenticated encryption.** AES-256-GCM provides confidentiality + integrity. Tampered ciphertext is rejected.
6. **Content-addressed storage.** On Swarm, data integrity is verified by hash. Adapter can't silently corrupt.

### Known limitations (from codex audit)

1. **ACT revocation is metadata-only.** Old Swarm refs immutable. Use `rotateAccess()` for true revocation.
2. **ACT metadata unsigned after revoke.** Malicious adapter could replay old metadata. Fix: require signed updates.
3. **Escrow buyer-key binding gap.** Contract doesn't bind buyer pubkey on-chain. Seller can encrypt to wrong key. Needs contract upgrade.
4. **JS can't guarantee hard zeroization.** SecureWallet zeros variables but GC decides when memory is freed. Not equivalent to hardware enclave.
5. **SecureStore fallback uses machine traits.** If OS keychain unavailable, encryption key derived from hostname/CPU/NIC. Weak against same-host malware. SDK should require explicit passphrase for fallback.
6. **GSOC inbox sender is forgeable.** `sender` field is unauthenticated JSON. Treat as hint only.
7. **GSOC inbox metadata visible.** Message timing, filename, size visible to anyone with inbox params. Payload is encrypted.
8. **ECDH KDF for sends uses SHA-256.** Should migrate to HKDF with domain separation (escrow already uses HKDF).

### Security properties by backend

| Property | Swarm | S3 | IPFS | Local |
|----------|-------|-----|------|-------|
| Ciphertext confidentiality | YES | YES | YES | YES |
| Key custody (client-side) | YES | YES | YES | YES |
| Content integrity (hash) | YES | NO | YES | NO |
| Availability (decentralized) | YES | NO | Partial | NO |
| Rollback resistance | YES | NO | YES | NO |
| Traffic analysis protection | Partial | NO | Partial | N/A |
| Object name secrecy | YES | NO | NO | NO |
| Native ACT sharing | YES | NO | NO | NO |
| Native GSOC messaging | YES | NO | NO | NO |
| Censorship resistance | YES | NO | Partial | N/A |

**Non-Swarm warning:** SDK MUST warn: "Using {adapter}: content confidentiality preserved, but availability, integrity, and metadata privacy depend on the storage provider."

---

## Testing Requirements

### Unit tests
- Every public method has at least one test
- Every error code has a test that triggers it
- Every conflict strategy tested (overwrite, skip, rename)
- Encryption round-trip: encrypt → store → retrieve → decrypt
- Key derivation matches Go fds-id-go (cross-platform interop)

### Integration tests (against Sepolia + Bee)
- Full lifecycle: create identity → put → get → send → receive → sell → buy
- Pod sharing: create → share → accept → read as grantee → write as grantee → revoke → verify denied
- Escrow: create → fund → commit → reveal → claim. Also: expire → claimExpired. Also: dispute flow.
- Large file chunking: upload 10MB → download → verify hash
- Multi-identity: create 2 accounts, send between them

### Smoke tests
- `fds.status()` returns connected after init
- `fds.put()` + `fds.get()` round-trip
- `fds.send()` to a known test account

### Stress tests
- Concurrent puts (10 parallel uploads)
- Large pod listing (100+ files)
- Rapid send/receive cycles
- Stamp exhaustion handling

### Test accounts (Sepolia)
- Alice (index 0), Bob (index 1), Carol (index 2), Arbiter (index 3) — funded
- Eve (index 10), Frank (index 11), Grace (index 12) — unfunded (edge cases)
- Mnemonic: `test test test test test test test test test test test junk`
- DataEscrow contract: `0xa226...14b6` (Sepolia)

---

## Package Structure

```
@fairdatasociety/fds (fds-ts repo)
├── src/
│   ├── index.ts
│   ├── client.ts             — FdsClient composition root
│   ├── types.ts              — All types
│   ├── errors.ts             — FdsError + codes + recovery
│   ├── services/
│   │   ├── identity.ts       — wraps fds-id
│   │   ├── storage.ts        — wraps adapter + encryption layer
│   │   ├── transfer.ts       — wraps fairdrop send/inbox/GSOC
│   │   ├── sharing.ts        — wraps fairdrive ACT + fairdrop ACT
│   │   ├── escrow.ts         — wraps fairdrop escrow
│   │   ├── publish.ts        — public Swarm uploads
│   │   └── stamps.ts         — stamp management
│   ├── adapters/
│   │   ├── interface.ts      — StorageAdapter
│   │   ├── swarm.ts          — SwarmAdapter
│   │   └── local.ts          — LocalAdapter
│   ├── crypto/
│   │   ├── encryption.ts     — AES-256-GCM file encryption
│   │   ├── ecdh.ts           — ECDH for send + ACT
│   │   └── keys.ts           — key derivation (pod key, file key)
│   ├── fairdrop/             — consolidated fairdrop core + SDK source
│   └── fairdrive/            — consolidated fairdrive core source
├── test/
│   ├── unit/                 — per-service unit tests
│   ├── integration/          — Sepolia + Bee tests
│   ├── smoke/                — quick sanity checks
│   └── stress/               — load and concurrency tests
└── package.json
```

---

## Security Audit Results (2026-04-29)

Two independent audits: Claude security review + Codex adversarial audit (GPT-5.4).

### CRITICAL

| # | Finding | Source | Attack | Fix |
|---|---------|--------|--------|-----|
| S1 | **Fairdrop ACT wrapper doesn't use Bee's native ACT encryption.** Bee API supports `{ act: true }` in UploadOptions and `{ actPublisher, actHistoryAddress }` in DownloadOptions — the Bee node handles encryption natively. But `client.ts:uploadWithAct()` calls `uploadData()` + `createGrantees()` separately without passing `act: true`. **Bee ACT IS secure — the wrapper has a bug.** | Codex: client.ts:1849; bee-js UploadOptions.act | Data uploaded without ACT encryption flag. Grantee list exists but data is unencrypted. | Fix `uploadWithAct()` to pass `{ act: true }` to `uploadData()`. Fix `downloadWithAct()` to pass `{ actPublisher, actHistoryAddress }` to `downloadData()`. This is a ~5 line fix, not a design flaw. |
| S2 | **Adapter metadata leaks.** Bucket names (pod names) and object keys (file paths) pass to adapter in plaintext. On S3, provider sees `medical-records/hiv-test.pdf`. | Claude: adapter interface | Correlation attack: no decryption needed, metadata is enough. | Encrypt bucket names and object keys before adapter. Or clearly document S3/IPFS adapters are NOT private for metadata (block until v2). |

### HIGH

| # | Finding | Source | Attack | Fix |
|---|---------|--------|--------|-----|
| S3 | **Inbox DoS: trivial.** Anyone with published inbox params can spam all slots. No rate limiting or auth on writes. Sparse placement can hide real messages. | Both audits | Fill inbox → recipient can't receive. Place garbage at high indices → pollInbox skips real messages. | Require proof-of-work or signed payloads. Add inbox capacity limits. Pagination in poll. |
| S4 | **Sender impersonation: trivial.** `sender` and `senderPubkey` fields in inbox messages are unsigned JSON. Any sender can claim to be anyone. | Both: client.ts:559, gsoc.ts:176 | Send message appearing to come from `alice.eth` to `bob.eth`. Bob's UI shows it as from Alice. | Sign inbox payloads with sender's key. Verify on receive. Treat unsigned sender as "anonymous" in UI. |
| S5 | **Post-revocation access + metadata replay.** `revoke()` deletes signature from ACT metadata. `loadMetadata()` accepts unsigned metadata. Malicious adapter replays pre-revoke metadata. | Codex: ACT.ts:331, 432 | Revoked user or colluding adapter restores old metadata → access regained. | Require signed metadata for ALL updates including revoke. Add monotonic version counter. |
| S6 | **File index integrity not verified.** `loadFileIndex()` trusts unencrypted desktop index, never verifies `indexHash`. Spec claims adapter can't corrupt. | Codex: FileManager.ts:460 | Malicious adapter manipulates file index → redirect downloads to wrong files, hide files, add fake entries. | Verify `indexHash` on every load. Sign file index. |
| S7 | **"Anonymous" send not anonymous at network layer.** Upload goes through sender's Bee node. Bee operator sees sender IP + Swarm reference + timing. Overlay address is persistent. | Both audits | Gateway operator correlates uploads to IPs. Swarm network correlates overlay to activity over time. | Document clearly: anonymity is application-layer only (no sender field). NOT network-layer. True anonymity requires Tor/mixnet. |
| S8 | **ACT social graph leaked to Bee.** Fairdrive ACT metadata includes `owner`, `ownerPublicKey`, every grantee address/pubkey, audit log. All visible to Bee node operator. | Codex: ACT.ts:31,40 | Bee operator maps who shares with whom. Complete social graph reconstruction. | Encrypt ACT metadata (not just content). Or accept this as a known limitation of the Swarm model. |
| S9 | **Delete doesn't delete.** `delete()` removes index entry. Data persists on Swarm (immutable). `downloadByRef()` fetches any known ref directly. | Codex: FileManager.ts:261,302 | Anyone who logged a Swarm reference can retrieve "deleted" data forever. | Document: delete is index removal, not data destruction. This is inherent to content-addressed storage. Not a bug. |
| S10 | **Deterministic escrow keys enable correlation.** Same seller + same plaintext → same key/IV → same ciphertext → same Swarm reference. Built-in correlation oracle for `createEscrowForSkill()`. | Codex: escrow.ts:308 | Observer correlates escrow listings to identify same data sold multiple times. | Document as intended behavior for skill exchange. Add optional randomization parameter. |

### MEDIUM

| # | Finding | Source | Fix |
|---|---------|--------|-----|
| S11 | Pod name containing `:pod:` could create key derivation ambiguity. | Claude | Validate pod names: reject colons. Or length-prefix pod name in KDF input. |
| S12 | SecureWallet uses 16-byte IV (non-standard for GCM). Works but reduces birthday-bound safety. | Claude: SecureWallet.ts:44 | Technical debt. Document. Cannot change without data migration. |
| S13 | Cross-backend key reuse: same identity + pod + file → identical ciphertext on Swarm and S3. | Claude | Include backend type in PBKDF2 salt. |
| S14 | ECDH for sends uses SHA-256 not HKDF. No domain separation. | Both | Migrate to HKDF with domain string `"fairdrop-send-v1"`. |
| S15 | Escrow key persistence: no minimum password entropy, hardcoded path. | Claude | Enforce minimum entropy. Make path configurable. Integrate with OS keychain. |
| S16 | Account creation non-atomic: partial failure leaves orphaned wallet. | Claude | Idempotent creation keyed by wallet address. Resume on retry. |

### Implementation Priority

**Must fix before v1 release:**
- S1 (Bee-native ACT verification)
- S3 (Inbox DoS — at minimum document, ideally add proof-of-work)
- S4 (Sign inbox payloads)
- S5 (Signed ACT metadata for revoke)
- S6 (File index integrity verification)
- S7, S8, S9 (Documentation — these are inherent limitations, not bugs)
- S16 (Atomic account creation)

**Should fix before v1:**
- S11, S13, S14 (Key derivation improvements)
- S15 (Escrow key security)
- S12 (Document the 16-byte IV)

**Fix before S3/IPFS adapter release:**
- S2 (Metadata encryption for non-Swarm adapters)

**Accept with documentation:**
- S10 (Deterministic escrow correlation — by design for skill exchange)

---

## Future (not v1)

- **ERC-8004 identity** — extend FDS account with on-chain identity claims
- **Gateway mode** — `api.fairdatasociety.org` with signed envelopes
- **S3/IPFS adapters** — plug alternative storage backends
- **Structured data** — JSON documents with schemas (Ceramic-like)
- **Multi-account** — switch between identities in one client
