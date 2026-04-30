import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/adapters/index.ts',
    // Subpath exports for direct consumption by Fairdrop, Fairdrive, etc.
    'src/crypto/index.ts',
    'src/identity/index.ts',
    'src/access/index.ts',
    'src/fairdrive-exports.ts',
    'src/fairdrive-node.ts',
    'src/fairdrop-exports.ts',
    'src/cli/index.ts',
    'src/mcp/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
  sourcemap: true,
  splitting: false,
  external: ['keytar'],
})
