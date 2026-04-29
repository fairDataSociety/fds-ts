/**
 * GSOC (Graffiti Single Owner Chunks) Inbox Operations for SDK
 *
 * Ported from src/services/swarm/gsoc.ts (UI).
 * Enables zero-leak private messaging where all senders use the same
 * derived GSOC key (network-level anonymity).
 *
 * Architecture:
 * 1. Recipient mines GSOC key for their neighborhood and publishes params to ENS
 * 2. Senders derive the same key from params and write to indexed slots
 * 3. Recipient polls slots to discover new messages
 */

import type { Bee, PrivateKey } from '@ethersphere/bee-js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { InboxParams, GSOCMessage } from './sdk-types.js'

// Version prefix for inbox identifiers
export const INBOX_PREFIX = 'fairdrop-inbox-v2'

/**
 * Mined inbox result
 */
export interface MinedInbox {
  privateKey: unknown // bee-js PrivateKey type
  params: InboxParams
}

/**
 * Subscription callbacks
 */
export interface SubscriptionCallbacks {
  onMessage?: (message: GSOCMessage) => void
  onError?: (error: Error) => void
  onClose?: () => void
}

/**
 * Subscription handle
 */
export interface GSOCSubscription {
  cancel: () => void
  getCurrentIndex: () => number
  isActive: () => boolean
}

/**
 * Get indexed identifier for a specific message slot.
 * Each message uses a unique slot to avoid overwrites.
 */
export function getIndexedIdentifier(baseIdentifier: string, index: number): string {
  // Remove 0x prefix if present, convert to bytes
  const idBytes = hexToBytes(baseIdentifier.replace(/^0x/, ''))
  const idxBytes = new TextEncoder().encode(index.toString())

  // Concatenate and hash
  const combined = new Uint8Array(idBytes.length + idxBytes.length)
  combined.set(idBytes, 0)
  combined.set(idxBytes, idBytes.length)

  return '0x' + bytesToHex(keccak_256(combined))
}

/**
 * Derive GSOC key from published params (sender does this).
 * All senders derive the same key — this provides network anonymity.
 */
export function deriveInboxKey(bee: Bee, params: InboxParams): PrivateKey {
  return bee.gsocMine(
    params.targetOverlay,
    params.baseIdentifier,
    params.proximity || 16
  )
}

/**
 * Get the owner address from GSOC params.
 * This is the address that owns all SOCs in this inbox.
 */
export function getInboxOwner(bee: Bee, params: InboxParams): string {
  const gsocKey = deriveInboxKey(bee, params)
  return '0x' + gsocKey.publicKey().address().toHex()
}

/**
 * Mine a GSOC private key for inbox (recipient does this once).
 * The mined key produces an address within the target neighborhood.
 */
export function mineInboxKey(
  bee: Bee,
  targetOverlay: string,
  proximity = 16
): MinedInbox {
  // Generate unique base identifier for this inbox
  const raw = new TextEncoder().encode(
    INBOX_PREFIX + Date.now().toString() + Math.random()
  )
  const baseIdentifier = '0x' + bytesToHex(keccak_256(raw))

  const gsocKey = bee.gsocMine(targetOverlay, baseIdentifier, proximity)

  return {
    privateKey: gsocKey,
    params: {
      targetOverlay,
      baseIdentifier,
      proximity,
    },
  }
}

// SOC header: identifier (32) + signature (65) + span (8) = 105 bytes
const SOC_HEADER_SIZE = 32 + 65 + 8

/**
 * Parse message bytes from SOC result.
 *
 * bee-js v11 has a bug where result.payload returns zeroed bytes.
 * Workaround: extract payload from result.data by skipping the SOC header
 * (identifier 32 + signature 65 + span 8 = 105 bytes).
 */
function parseMessageBytes(result: unknown): GSOCMessage {
  const res = result as Record<string, unknown>
  const data = res.data
  const payload = res.payload

  let payloadBytes: Uint8Array

  // Prefer result.data with header stripping (works around bee-js v11 payload bug)
  if (data instanceof Uint8Array && data.length > SOC_HEADER_SIZE) {
    payloadBytes = data.slice(SOC_HEADER_SIZE)
  } else if (payload instanceof Uint8Array) {
    payloadBytes = payload
  } else if (payload && typeof payload === 'object' && 'buffer' in payload) {
    const view = payload as { buffer: ArrayBuffer; byteOffset: number; byteLength: number }
    payloadBytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  } else if (typeof payload === 'string') {
    return JSON.parse(payload) as GSOCMessage
  } else if (data instanceof Uint8Array) {
    payloadBytes = data
  } else if (data && typeof data === 'object') {
    payloadBytes = new Uint8Array(data as ArrayLike<number>)
  } else {
    payloadBytes = new Uint8Array(result as ArrayLike<number>)
  }

  const decoded = new TextDecoder().decode(payloadBytes)
  try {
    return JSON.parse(decoded) as GSOCMessage
  } catch {
    // Real Bee SOC data may include binary prefixes
    const jsonStart = decoded.indexOf('{"version":')
    if (jsonStart >= 0) {
      let braceCount = 0
      let jsonEnd = -1
      for (let i = jsonStart; i < decoded.length; i++) {
        if (decoded[i] === '{') braceCount++
        if (decoded[i] === '}') braceCount--
        if (braceCount === 0) {
          jsonEnd = i + 1
          break
        }
      }
      if (jsonEnd > jsonStart) {
        return JSON.parse(decoded.slice(jsonStart, jsonEnd)) as GSOCMessage
      }
    }
    throw new Error('Invalid SOC payload format - no valid JSON found')
  }
}

/**
 * Write message to inbox slot.
 */
export async function writeToInbox(
  bee: Bee,
  params: InboxParams,
  index: number,
  payload: { reference: string; filename?: string; size?: number; sender?: string; senderPubkey?: string; contentType?: string; note?: string },
  stampId: string
): Promise<unknown> {
  const gsocKey = deriveInboxKey(bee, params)
  const identifier = getIndexedIdentifier(params.baseIdentifier, index)

  const message: GSOCMessage = {
    version: 1,
    reference: payload.reference,
    timestamp: Date.now(),
    filename: payload.filename,
    size: payload.size,
    ...(payload.sender && { sender: payload.sender }),
    ...(payload.senderPubkey && { senderPubkey: payload.senderPubkey }),
    ...(payload.contentType && { contentType: payload.contentType }),
    ...(payload.note && { note: payload.note }),
  }

  const messageBytes = new TextEncoder().encode(JSON.stringify(message))
  return bee.gsocSend(stampId, gsocKey, identifier, messageBytes)
}

/**
 * Read message from inbox slot.
 */
export async function readInboxSlot(
  bee: Bee,
  params: InboxParams,
  index: number
): Promise<GSOCMessage | null> {
  const owner = getInboxOwner(bee, params)
  const identifier = getIndexedIdentifier(params.baseIdentifier, index)

  try {
    const reader = bee.makeSOCReader(owner)
    const result = await reader.download(identifier)
    return parseMessageBytes(result)
  } catch (error) {
    const err = error as { message?: string; status?: number }
    if (
      err.message?.includes('not found') ||
      err.status === 404 ||
      err.message?.includes('404')
    ) {
      return null
    }
    throw error
  }
}

/**
 * Poll inbox for all messages starting from an index.
 * Uses parallel requests for speed, stops after consecutive empty batches.
 */
export async function pollInbox(
  bee: Bee,
  params: InboxParams,
  lastKnownIndex = 0,
  maxScan = 20
): Promise<GSOCMessage[]> {
  const BATCH_SIZE = 5
  const MAX_EMPTY_BATCHES = maxScan > 50 ? 4 : 2

  const messages: GSOCMessage[] = []
  let emptyBatches = 0
  let currentIndex = lastKnownIndex

  while (currentIndex < lastKnownIndex + maxScan && emptyBatches < MAX_EMPTY_BATCHES) {
    const batchPromises: Promise<GSOCMessage | null>[] = []
    for (let i = 0; i < BATCH_SIZE && currentIndex + i < lastKnownIndex + maxScan; i++) {
      const idx = currentIndex + i
      batchPromises.push(
        readInboxSlot(bee, params, idx)
          .then((msg) => (msg ? { ...msg, index: idx } : null))
          .catch(() => null)
      )
    }

    const results = await Promise.all(batchPromises)
    const batchMessages = results.filter((m): m is GSOCMessage => m !== null)

    if (batchMessages.length === 0) {
      emptyBatches++
    } else {
      emptyBatches = 0
      messages.push(...batchMessages)
    }

    currentIndex += BATCH_SIZE
  }

  return messages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
}

/**
 * Find the next available slot for writing.
 * Uses exponential search + binary search for efficiency.
 */
export async function findNextSlot(
  bee: Bee,
  params: InboxParams,
  maxSlots = 10000
): Promise<number> {
  let low = 0
  let high = 1

  while (high < maxSlots) {
    const msg = await readInboxSlot(bee, params, high)
    if (!msg) break
    low = high
    high *= 2
  }

  high = Math.min(high, maxSlots)

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const msg = await readInboxSlot(bee, params, mid)
    if (msg) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

/**
 * Subscribe to inbox for real-time message notifications via WebSocket.
 * Uses bee.gsocSubscribe() for instant delivery instead of polling.
 */
export function subscribeToInbox(
  bee: Bee,
  params: InboxParams,
  startIndex: number,
  callbacks: SubscriptionCallbacks
): GSOCSubscription {
  const owner = getInboxOwner(bee, params)

  let currentIndex = startIndex
  let currentSubscription: { cancel?: () => void } | null = null
  let cancelled = false
  let reconnectAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 5
  const RECONNECT_DELAY_MS = 2000

  const parseMessage = (messageBytes: unknown): GSOCMessage => {
    let bytes: Uint8Array
    const mb = messageBytes as { toUint8Array?: () => Uint8Array }

    if (messageBytes instanceof Uint8Array) {
      bytes = messageBytes
    } else if (mb.toUint8Array) {
      bytes = mb.toUint8Array()
    } else if (typeof messageBytes === 'string') {
      return JSON.parse(messageBytes) as GSOCMessage
    } else {
      bytes = new Uint8Array(messageBytes as ArrayLike<number>)
    }

    const decoded = new TextDecoder().decode(bytes)

    try {
      return JSON.parse(decoded) as GSOCMessage
    } catch {
      const jsonStart = decoded.indexOf('{"version":')
      if (jsonStart >= 0) {
        let braceCount = 0
        let jsonEnd = -1
        for (let i = jsonStart; i < decoded.length; i++) {
          if (decoded[i] === '{') braceCount++
          if (decoded[i] === '}') braceCount--
          if (braceCount === 0) {
            jsonEnd = i + 1
            break
          }
        }
        if (jsonEnd > jsonStart) {
          return JSON.parse(decoded.slice(jsonStart, jsonEnd)) as GSOCMessage
        }
      }
      throw new Error('Invalid message format')
    }
  }

  const subscribeToSlot = (index: number): void => {
    if (cancelled) return

    const identifier = getIndexedIdentifier(params.baseIdentifier, index)

    try {
      currentSubscription = bee.gsocSubscribe(owner, identifier, {
        onMessage: (messageBytes: unknown) => {
          try {
            const message = parseMessage(messageBytes)
            reconnectAttempts = 0
            callbacks.onMessage?.({ ...message, index })
            currentIndex = index + 1
            subscribeToSlot(currentIndex)
          } catch (error) {
            callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
          }
        },
        onError: (error: Error) => {
          if (!cancelled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++
            const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1)
            setTimeout(() => subscribeToSlot(index), delay)
          } else {
            callbacks.onError?.(error)
          }
        },
        onClose: () => {
          if (!cancelled) {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts++
              const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1)
              setTimeout(() => subscribeToSlot(index), delay)
            } else {
              callbacks.onClose?.()
            }
          } else {
            callbacks.onClose?.()
          }
        },
      }) as { cancel?: () => void }
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  subscribeToSlot(currentIndex)

  return {
    cancel: () => {
      cancelled = true
      currentSubscription?.cancel?.()
    },
    getCurrentIndex: () => currentIndex,
    isActive: () => !cancelled,
  }
}

/**
 * Check if an inbox has any messages.
 */
export async function hasMessages(bee: Bee, params: InboxParams): Promise<boolean> {
  const msg = await readInboxSlot(bee, params, 0)
  return msg !== null
}
