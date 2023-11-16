import { copyFileSync } from 'fs'

await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist/bun',
  minify: false,
  target: 'bun',
  sourcemap: 'external',
  splitting: true
})

copyFileSync('dist/index.d.ts', 'dist/bun/index.d.ts')

export {}