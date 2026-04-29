/**
 * SharingService Tests — TDD
 *
 * Tests ACT-based sharing: grant, accept, revoke, grantees.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SharingService } from '../../../src/services/sharing.js'

describe('SharingService', () => {
  let sharing: SharingService

  beforeEach(() => {
    sharing = new SharingService()
  })

  it('grant throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(
      sharing.grant('research', 'alice.eth')
    ).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('revoke throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(
      sharing.revoke('research', 'bob.eth')
    ).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('list throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(sharing.list('research')).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('rotateAccess throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(sharing.rotateAccess('research')).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })
})
