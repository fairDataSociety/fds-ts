/**
 * PublishService — public (unencrypted) data on Swarm.
 *
 * publish() uploads without encryption. Anyone with the reference can read.
 * This is the explicit opt-out from encryption-by-default.
 */

import { FdsError, FdsErrorCode } from '../errors.js'

export interface PublishOptions {
  filename?: string
  contentType?: string
  directory?: boolean
}

export interface PublishResult {
  reference: string
  url?: string
}

export class PublishService {
  /** Publish data publicly (unencrypted). */
  async upload(data: string | Buffer | Uint8Array, opts?: PublishOptions): Promise<PublishResult> {
    // TODO: Wire to FairdropClient.upload() or direct Bee /bzz upload
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'PublishService requires Bee node connection')
  }
}
