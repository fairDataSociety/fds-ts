/**
 * TransferService — encrypted messaging with real GSOC delivery.
 *
 * Send: ECDH-encrypt for recipient → upload to Swarm → write notification to recipient's GSOC inbox.
 * Receive: poll the user's own GSOC inbox slots → list messages.
 *
 * Without a configured Bee node, send/receive throw NO_BEE.
 * The local-only outbox simulation is gone — was misleading.
 *
 * GSOC port: src/fairdrop/gsoc.ts (working code from fairdrop SDK).
 */

import type { SendOptions, SendResult, InboxMessage, InboxSubscription } from '../types.js'
import type { InboxParams } from '../fairdrop/sdk-types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import type { IdentityService } from './identity.js'
import { encryptForRecipient, decryptFromSender } from '../crypto/ecdh.js'
import { FdsError, FdsErrorCode } from '../errors.js'
import {
  mineInboxKey,
  writeToInbox,
  pollInbox,
  findNextSlot,
  subscribeToInbox,
} from '../fairdrop/gsoc.js'

interface BeeLike {
  uploadData(batchId: string, data: Uint8Array, opts?: any): Promise<{ reference: { toString(): string } }>
  downloadData(reference: string, opts?: any): Promise<{ toUint8Array(): Uint8Array }>
  gsocMine(targetOverlay: string, identifier: string, proximity: number): any
  gsocSend(stampId: string, key: any, identifier: string, data: Uint8Array): Promise<unknown>
  makeSOCReader(owner: string): { download(identifier: string): Promise<unknown> }
  gsocSubscribe(owner: string, identifier: string, handler: any): { cancel(): void }
}

export class TransferService {
  private adapter?: StorageAdapter
  private identity?: IdentityService
  private bee?: BeeLike
  private batchId?: string
  /** Cached own inbox params after first registration */
  private ownInbox?: { params: InboxParams; nextIndex: number }

  /** Wire dependencies. Bee instance optional but required for real send/receive. */
  init(adapter: StorageAdapter, identity: IdentityService, bee?: BeeLike, batchId?: string): void {
    this.adapter = adapter
    this.identity = identity
    this.bee = bee
    this.batchId = batchId
  }

  get isInitialized(): boolean {
    return !!(this.adapter && this.identity)
  }

  /** Whether GSOC delivery is available (Bee + batchId configured). */
  get canDeliver(): boolean {
    return !!(this.bee && this.batchId)
  }

  /**
   * Register an inbox: mine the GSOC key for the recipient's neighborhood.
   * Caller stores returned params in ENS so senders can find them.
   */
  async registerInbox(targetOverlay: string, proximity = 16): Promise<InboxParams> {
    if (!this.bee) throw new FdsError(FdsErrorCode.NO_STORAGE, 'Bee node required to register inbox')
    const mined = mineInboxKey(this.bee as any, targetOverlay, proximity)
    this.ownInbox = { params: mined.params, nextIndex: 0 }
    return mined.params
  }

  /**
   * Send encrypted data to a recipient.
   *
   * Steps:
   * 1. Resolve recipient public key + inbox params (from arg or ENS)
   * 2. ECDH-encrypt data with recipient's pubkey
   * 3. Upload encrypted blob to Swarm (raw bytes endpoint)
   * 4. Write notification to recipient's GSOC inbox slot
   */
  async send(
    recipient: string | { publicKey: string; inbox?: InboxParams },
    data: string | Buffer | Uint8Array,
    opts?: SendOptions,
  ): Promise<SendResult> {
    if (!this.adapter || !this.identity) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService not initialized')
    }
    if (!this.bee || !this.batchId) {
      throw new FdsError(FdsErrorCode.NO_STORAGE, 'Bee node + batchId required for send. Configure storage.beeUrl + batchId.')
    }

    const current = this.identity.current
    if (!current) {
      throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required to send')
    }

    // Resolve recipient
    const { publicKey, inbox } = await this.resolveRecipient(recipient)
    if (!publicKey) {
      throw new FdsError(FdsErrorCode.RECIPIENT_NO_PUBKEY, `Cannot resolve public key for: ${typeof recipient === 'string' ? recipient : '<obj>'}`)
    }
    if (!inbox) {
      throw new FdsError(FdsErrorCode.RECIPIENT_NO_PUBKEY, 'Recipient has no inbox params. Pass them explicitly or ensure they are published.')
    }

    // Coerce to bytes
    const plaintext = typeof data === 'string' ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data)

    // ECDH encrypt for recipient
    const pubKeyBytes = hexToBytes(publicKey)
    const encrypted = encryptForRecipient(plaintext, pubKeyBytes)

    // Upload encrypted blob to Swarm
    const upload = await this.bee.uploadData(this.batchId, encrypted)
    const reference = upload.reference.toString()

    // Write GSOC notification to recipient's inbox
    const slotIndex = await findNextSlot(this.bee as any, inbox)
    await writeToInbox(this.bee as any, inbox, slotIndex, {
      reference,
      filename: opts?.filename,
      size: encrypted.length,
      sender: opts?.anonymous ? undefined : current.address,
      senderPubkey: opts?.anonymous ? undefined : current.publicKey,
      contentType: opts?.contentType,
      note: opts?.note,
    }, this.batchId)

    return { reference, recipient: typeof recipient === 'string' ? recipient : recipient.publicKey, encrypted: true }
  }

  /** Read the user's GSOC inbox. Returns received messages. */
  async receive(): Promise<InboxMessage[]> {
    if (!this.bee || !this.ownInbox) {
      // Without inbox, return empty rather than error — supports first-run flow
      return []
    }

    const messages = await pollInbox(this.bee as any, this.ownInbox.params, this.ownInbox.nextIndex)
    if (messages.length > 0) {
      // Advance the next-index past the highest seen slot
      const maxIdx = Math.max(...messages.map(m => (m as any).index ?? 0))
      this.ownInbox.nextIndex = maxIdx + 1
    }
    return messages.map(m => ({
      sender: m.sender,
      filename: m.filename,
      reference: m.reference,
      timestamp: new Date(m.timestamp),
      size: m.size,
      contentType: m.contentType,
      note: m.note,
      type: 'message' as const,
    }))
  }

  /**
   * Download and decrypt a received message by its reference.
   * Caller must be the intended recipient (their privkey decrypts).
   */
  async readMessage(reference: string): Promise<Uint8Array> {
    if (!this.bee) throw new FdsError(FdsErrorCode.NO_STORAGE, 'Bee node required')
    if (!this.identity) throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required')
    const privKey = this.identity.getPrivateKey()
    if (!privKey) throw new FdsError(FdsErrorCode.IDENTITY_LOCKED, 'Identity locked')

    const blob = await this.bee.downloadData(reference)
    const encrypted = blob.toUint8Array()
    return decryptFromSender(encrypted, hexToBytes(privKey))
  }

  /** Subscribe to inbox via real-time GSOC WebSocket subscription. */
  subscribe(callback: (msg: InboxMessage) => void): InboxSubscription {
    if (!this.bee || !this.ownInbox) {
      // Polling fallback if no Bee — returns immediately-cancellable handle
      return { unsubscribe: () => {} }
    }

    const sub = subscribeToInbox(this.bee as any, this.ownInbox.params, this.ownInbox.nextIndex, {
      onMessage: (m) => callback({
        sender: m.sender,
        filename: m.filename,
        reference: m.reference,
        timestamp: new Date(m.timestamp),
        size: m.size,
        contentType: m.contentType,
        note: m.note,
        type: 'message' as const,
      }),
    })

    return { unsubscribe: () => sub.cancel() }
  }

  /**
   * Resolve recipient string or object to { publicKey, inbox }.
   * - Hex pubkey: requires inbox params passed separately
   * - Object form: { publicKey, inbox }
   * - ENS name: resolved via identity service (looks up text records)
   */
  private async resolveRecipient(recipient: string | { publicKey: string; inbox?: InboxParams }): Promise<{ publicKey?: string; inbox?: InboxParams }> {
    if (typeof recipient === 'object') {
      return { publicKey: recipient.publicKey, inbox: recipient.inbox }
    }
    if (recipient.startsWith('0x') && recipient.length >= 66) {
      // Direct hex pubkey — caller must provide inbox separately or fail
      return { publicKey: recipient }
    }
    // ENS resolution requires chain + ENS lookup — currently not implemented in identity service
    return {}
  }
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}
