import { $ } from 'bun'
import { build, type Options } from 'tsup'
import { fixImportsPlugin } from 'esbuild-fix-imports-plugin'

import pack from './package.json'

const bundledDeps = ['reflect-metadata', 'zod']

const external = [
    ...Object.keys(pack.dependencies ?? {}),
    ...Object.keys(pack.peerDependencies ?? {})
].filter(dep => !bundledDeps.includes(dep))

await $`rm -rf dist`

await build({
    entry: ['src/**/*.ts'],
    outDir: 'dist',
    format: ['esm', 'cjs'],
    target: 'node20',
    minifySyntax: true,
    minifyWhitespace: false,
    minifyIdentifiers: false,
    splitting: false,
    sourcemap: false,
    cjsInterop: false,
    clean: true,
    bundle: false,
    external,
    esbuildPlugins: [fixImportsPlugin()]
})

/*
  Declarations only, and forced.

  tsconfig.json is composite, so a plain `tsc --project` is incremental: with a
  fresh tsconfig.tsbuildinfo it considers the (already deleted) dist up to date
  and emits nothing, which is how 1.6.1 shipped without a single .d.ts. The
  buildinfo is removed and --force passed so the emit always happens.

  tsconfig.dts.json also sets emitDeclarationOnly, otherwise tsc would overwrite
  the JS that tsup just wrote with its own CommonJS output.
*/
await $`rm -rf tsconfig.dts.tsbuildinfo`
await $`tsc --build tsconfig.dts.json --force`

await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist/bun',
    minify: {
        whitespace: true,
        syntax: true,
        identifiers: false
    },
    target: 'bun',
    sourcemap: 'linked',
    external
})

process.exit()
