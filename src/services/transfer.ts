/**
 * TransferService — encrypted messaging (send, receive, subscribe).
 *
 * Send: encrypt with ECDH (ephemeral key + recipient pubkey) → upload → notify inbox.
 * Receive: poll inbox bucket for messages → decrypt.
 *
 * Uses our ECDH module (HKDF domain separation, S14 fix).
 *
 * Security notes:
 * - Sender field in inbox is UNAUTHENTICATED (S4). Treat as hint.
 * - Anonymity is application-layer only, NOT network-layer (S7).
 */

import type { SendOptions, SendResult, InboxMessage, InboxSubscription } from '../types.js'
import type { StorageAdapter } from '../adapters/interface.js'
import type { IdentityService } from './identity.js'
import { encryptForRecipient } from '../crypto/ecdh.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export class TransferService {
  private adapter?: StorageAdapter
  private identity?: IdentityService

  /** Wire dependencies. Called by FdsClient constructor. */
  init(adapter: StorageAdapter, identity: IdentityService): void {
    this.adapter = adapter
    this.identity = identity
  }

  get isInitialized(): boolean {
    return !!(this.adapter && this.identity)
  }

  /**
   * Send encrypted data to a recipient.
   *
   * 1. Resolve recipient public key
   * 2. Encrypt with ECDH (ephemeral + recipient pubkey)
   * 3. Upload encrypted blob
   */
  async send(
    recipient: string,
    data: string | Buffer | Uint8Array,
    opts?: SendOptions
  ): Promise<SendResult> {
    if (!this.adapter || !this.identity) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService not initialized. Call fds.init() first.')
    }

    const current = this.identity.current
    if (!current) {
      throw new FdsError(FdsErrorCode.NO_IDENTITY, 'Identity required to send')
    }

    // Resolve recipient public key
    const recipientPubKey = this.resolveRecipientKey(recipient)
    if (!recipientPubKey) {
      throw new FdsError(FdsErrorCode.RECIPIENT_NO_PUBKEY, `Cannot resolve public key for: ${recipient}`)
    }

    // Coerce data
    const plaintext = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data)

    // Encrypt with ECDH
    const pubKeyBytes = hexToBytes(recipientPubKey)
    const encrypted = encryptForRecipient(plaintext, pubKeyBytes)

    // Store in outbox (full GSOC wiring needs Bee)
    const filename = opts?.filename || `msg-${Date.now()}.enc`
    if (!(await this.adapter.bucketExists('__outbox'))) {
      await this.adapter.createBucket('__outbox')
    }
    await this.adapter.put('__outbox', filename, encrypted)

    return {
      reference: `__outbox/${filename}`,
      recipient,
      encrypted: true,
    }
  }

  /** Check inbox for received messages. */
  async receive(): Promise<InboxMessage[]> {
    if (!this.adapter) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService not initialized')
    }

    const exists = await this.adapter.bucketExists('inbox')
    if (!exists) return []

    const result = await this.adapter.list('inbox')
    return result.objects.map(obj => ({
      filename: obj.key,
      reference: `inbox/${obj.key}`,
      timestamp: obj.lastModified,
      size: obj.size,
      type: 'message' as const,
    }))
  }

  /** Subscribe to inbox updates (polling fallback). */
  subscribe(callback: (message: InboxMessage) => void): InboxSubscription {
    if (!this.adapter) {
      throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService not initialized')
    }

    let active = true
    let lastCheck = new Date()

    const poll = async () => {
      while (active) {
        await new Promise(r => setTimeout(r, 30000))
        if (!active) break
        try {
          const messages = await this.receive()
          for (const msg of messages) {
            if (msg.timestamp > lastCheck) {
              callback(msg)
              lastCheck = msg.timestamp
            }
          }
        } catch { /* continue polling */ }
      }
    }
    poll()

    return { unsubscribe: () => { active = false } }
  }

  /** Resolve recipient to public key hex. */
  private resolveRecipientKey(recipient: string): string | null {
    // Direct hex pubkey
    if (recipient.startsWith('0x') && recipient.length >= 66) return recipient
    // TODO: ENS resolution via identity.resolve()
    return null
  }
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
