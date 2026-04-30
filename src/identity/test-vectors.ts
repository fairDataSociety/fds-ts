/**
 * Test Vectors for Cross-Platform Compatibility
 *
 * These test vectors ensure that fds-crypto-ts and fds-identity-ts
 * produce identical results to:
 * - fds-identity (Go implementation)
 * - Ethereum geth/go-ethereum
 * - Other Ethereum wallets
 *
 * IMPORTANT: Run these tests against both TS and Go implementations
 * to verify compatibility before release.
 */

// ============================================================================
// Wallet Test Vectors
// ============================================================================

export const walletTestVectors = [
  {
    name: 'Standard Test Key',
    privateKey: '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
    expectedAddress: '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23',
    description: 'Common test key used in Ethereum development',
  },
  {
    name: 'Zero Padding Key',
    privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
    expectedAddress: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    description: 'Key that requires zero padding',
  },
]

// ============================================================================
// Mnemonic Test Vectors (BIP-39)
// ============================================================================

export const mnemonicTestVectors = [
  {
    name: 'Test Mnemonic 1',
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    passphrase: '',
    expectedSeed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    path: "m/44'/60'/0'/0/0",
    expectedAddress: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    description: 'BIP-39 test vector with standard "abandon" mnemonic',
  },
]

// ============================================================================
// Keystore Test Vectors (Web3 Secret Storage v3)
// ============================================================================

export const keystoreTestVectors = [
  {
    name: 'Standard Keystore',
    password: 'testpassword123',
    privateKey: '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
    expectedAddress: '2c7536e3605d9c16a7a3d7b1898e529396a65c23', // lowercase, no 0x
    // Note: Cannot test exact ciphertext/MAC due to random salt/IV
    // But we test round-trip: encrypt then decrypt should give same key
  },
]

// ============================================================================
// Encryption Test Vectors (AES-256-GCM)
// ============================================================================

export const encryptionTestVectors = [
  {
    name: 'Known Key Encryption',
    plaintext: '48656c6c6f20576f726c64', // "Hello World" in hex
    key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    // Note: Cannot test exact ciphertext due to random nonce
    // Test round-trip instead
  },
]

// ============================================================================
// Scrypt Test Vectors
// ============================================================================

export const scryptTestVectors = [
  {
    name: 'Ethereum Standard Parameters',
    password: 'testpassword',
    salt: '0000000000000000000000000000000000000000000000000000000000000000',
    n: 131072,
    r: 8,
    p: 1,
    dkLen: 32,
    // Expected derived key (can be verified against geth)
    description: 'Scrypt with Ethereum standard N=131072',
  },
]

// ============================================================================
// Keccak-256 Test Vectors
// ============================================================================

export const keccak256TestVectors = [
  {
    name: 'Empty Input',
    input: '',
    expected: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  },
  {
    name: 'Hello World',
    input: '48656c6c6f20576f726c64', // "Hello World" in hex
    expected: '592fa743889fc7f92ac2a37bb1f5ba1daf2a5c84741ca0e0061d243a2e6707ba',
  },
]

// ============================================================================
// Message Signing Test Vectors (EIP-191)
// ============================================================================

export const signatureTestVectors = [
  {
    name: 'Personal Sign',
    privateKey: '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
    message: 'Hello, Ethereum!',
    // Expected signature can be verified against ethers.js/viem
  },
]
