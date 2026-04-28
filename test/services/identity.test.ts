import { describe, it, expect } from 'vitest'
import { IdentityService } from '../../src/services/identity.js'

describe('IdentityService', () => {
  it('creates identity with address and mnemonic', async () => {
    const svc = new IdentityService()
    const id = await svc.create()
    expect(id.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(id.mnemonic).toBeDefined()
    expect(id.mnemonic!.split(' ').length).toBe(12)
    expect(id.publicKey).toBeDefined()
  })

  it('creates with 24-word mnemonic', async () => {
    const svc = new IdentityService()
    const id = await svc.create({ wordCount: 24 })
    expect(id.mnemonic!.split(' ').length).toBe(24)
  })

  it('sets current identity after create', async () => {
    const svc = new IdentityService()
    expect(svc.current).toBeNull()
    await svc.create()
    expect(svc.current).not.toBeNull()
    expect(svc.current!.address).toMatch(/^0x/)
  })

  it('imports identity from mnemonic', async () => {
    const svc = new IdentityService()
    const created = await svc.create()

    const svc2 = new IdentityService()
    const imported = await svc2.import(created.mnemonic!)
    expect(imported.address).toBe(created.address)
    expect(imported.publicKey).toBe(created.publicKey)
    // mnemonic NOT returned on import
    expect(imported.mnemonic).toBeUndefined()
  })

  it('locks and unlocks', async () => {
    const svc = new IdentityService()
    await svc.create()
    expect(svc.isLocked).toBe(false)

    await svc.lock()
    expect(svc.isLocked).toBe(true)

    // Signing should fail when locked
    await expect(svc.sign('test')).rejects.toMatchObject({ code: 'IDENTITY_LOCKED' })

    await svc.unlock()
    expect(svc.isLocked).toBe(false)
  })

  it('signs a message', async () => {
    const svc = new IdentityService()
    await svc.create()
    const sig = await svc.sign('hello')
    expect(sig).toBeInstanceOf(Uint8Array)
    expect(sig.length).toBe(65) // R(32) + S(32) + V(1)
  })

  it('derives child accounts', async () => {
    const svc = new IdentityService()
    await svc.create()
    const child = await svc.deriveChild(1)
    expect(child.address).toMatch(/^0x/)
    expect(child.address).not.toBe(svc.current!.address) // different from account 0
  })

  it('exports and imports keystore', async () => {
    const svc = new IdentityService()
    const created = await svc.create()
    const ks = await svc.exportKeystore('test-password')
    expect(ks).toBeDefined()

    const svc2 = new IdentityService()
    const imported = await svc2.importKeystore(ks, 'test-password')
    expect(imported.address).toBe(created.address)
  })

  it('notifies on identity change', async () => {
    const svc = new IdentityService()
    let notified = false
    svc.onChange(() => { notified = true })
    await svc.create()
    expect(notified).toBe(true)
  })

  it('throws NO_IDENTITY when not created', async () => {
    const svc = new IdentityService()
    await expect(svc.sign('test')).rejects.toMatchObject({ code: 'NO_IDENTITY' })
  })

  it('throws NO_IDENTITY for deriveChild without HD wallet', async () => {
    const svc = new IdentityService()
    // Import from keystore (no HD wallet)
    const svc2 = new IdentityService()
    await svc2.create()
    const ks = await svc2.exportKeystore('pw')

    const svc3 = new IdentityService()
    await svc3.importKeystore(ks, 'pw')
    // No HD wallet → can't derive
    await expect(svc3.deriveChild(1)).rejects.toMatchObject({ code: 'NO_IDENTITY' })
  })
})
