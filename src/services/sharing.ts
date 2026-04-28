/**
 * SharingService — collaborative pod access via ACT (Access Control Trie).
 *
 * Wraps @fairdrive/core ACT + PodManager.share + @fairdrop/sdk ACT methods.
 */

import type { GrantInfo } from '../types.js'
import { FdsError, FdsErrorCode } from '../errors.js'

export class SharingService {
  /** Grant collaborative access to a bucket. */
  async grant(bucket: string, recipient: string): Promise<void> {
    // TODO: Wire ACT.grant + PodManager.share
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService not yet wired')
  }

  /** Grant access to a single file. */
  async grantFile(key: string, recipient: string): Promise<void> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService not yet wired')
  }

  /** List grantees for a bucket. */
  async list(bucket: string): Promise<GrantInfo[]> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService not yet wired')
  }

  /** Revoke access for a grantee. */
  async revoke(bucket: string, grantee: string): Promise<void> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService not yet wired')
  }

  /** Check if someone has access. */
  async hasAccess(bucket: string, address: string): Promise<boolean> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService not yet wired')
  }

  /**
   * Rotate access — re-encrypt content under new DEK, re-grant to remaining users.
   * This is TRUE revocation (expensive: re-uploads all content).
   */
  async rotateAccess(bucket: string): Promise<void> {
    throw new FdsError(FdsErrorCode.ADAPTER_UNSUPPORTED, 'SharingService.rotateAccess not yet wired')
  }
}
