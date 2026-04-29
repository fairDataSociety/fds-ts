/**
 * EscrowService Tests — TDD
 *
 * Tests sell, buy, claim, dispute, prepare.
 * Unit tests verify interface. Integration tests hit Sepolia DataEscrow.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { EscrowService } from '../../../src/services/escrow.js'

describe('EscrowService', () => {
  let escrow: EscrowService

  beforeEach(() => {
    escrow = new EscrowService()
  })

  it('create throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(
      escrow.create('data/file.csv', { price: '0.01' })
    ).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('buy throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(escrow.buy(1n)).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('status throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(escrow.status(1n)).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('claim throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(escrow.claim(1n)).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('dispute throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(escrow.dispute(1n)).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })

  it('prepare.create throws ADAPTER_UNSUPPORTED until wired', async () => {
    await expect(escrow.prepare.create()).rejects.toMatchObject({ code: 'ADAPTER_UNSUPPORTED' })
  })
})
