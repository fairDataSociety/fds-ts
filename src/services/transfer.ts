/**
 * TransferService — encrypted messaging (send, receive, subscribe).
 *
 * Wraps @fairdrop/sdk FairdropClient: sendAnonymous, pollInbox, subscribeToInbox.
 * Requires @fairdrop/sdk to be available (not yet published to npm).
 */

import type { SendOptions, SendResult, InboxMessage, InboxSubscription } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export class TransferService {
  /**
   * Send encrypted data to a recipient.
   * Resolves ENS → encrypts with ECDH → uploads → notifies inbox.
   */
  async send(recipient: string, data: string | Buffer | Uint8Array, opts?: SendOptions): Promise<SendResult> {
    // TODO: Wire FairdropClient.sendAnonymous when @fairdrop/sdk is available
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService requires @fairdrop/sdk (not yet published)')
  }

  /** Check inbox for received messages (polling). */
  async receive(): Promise<InboxMessage[]> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService requires @fairdrop/sdk')
  }

  /** Subscribe to real-time inbox updates. */
  subscribe(callback: (message: InboxMessage) => void): InboxSubscription {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'TransferService requires @fairdrop/sdk')
  }
}
