#!/usr/bin/env bun
import { generate } from './codegen/generate';

interface CliArgs {
    root?: string;
    output?: string;
    include?: string[];
    tsconfig?: string;
    silent?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {};

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        const next = argv[i + 1];

        if (token === '--root' && next) {
            args.root = next;
            i += 1;
        } else if (token === '--output' && next) {
            args.output = next;
            i += 1;
        } else if (token === '--include' && next) {
            args.include = next.split(',').map((part) => part.trim()).filter(Boolean);
            i += 1;
        } else if (token === '--tsconfig' && next) {
            args.tsconfig = next;
            i += 1;
        } else if (token === '--silent') {
            args.silent = true;
        } else if (token === '--help' || token === '-h') {
            printUsage();
            process.exit(0);
        }
    }

    return args;
}

function printUsage(): void {
    console.log(`Usage: carno-client generate [options]

CI/escape-hatch generator. Day-to-day usage is app.use(Client()) or the Vite plugin.

Options:
  --root <dir>         Project root (default: cwd)
  --output <file>      Output file (default: src/generated/app.ts)
  --include <globs>    Comma-separated globs (default: src/**/*.ts)
  --tsconfig <file>    tsconfig path
  --silent             Suppress success logs
`);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const command = argv[0] === 'generate' ? 'generate' : argv[0]?.startsWith('-') ? 'generate' : argv[0];

    if (command && command !== 'generate') {
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }

    const rest = argv[0] === 'generate' ? argv.slice(1) : argv;
    const args = parseArgs(rest);

    const result = generate({
        root: args.root,
        output: args.output,
        include: args.include,
        tsconfig: args.tsconfig,
        silent: args.silent,
        watch: false,
        force: true
    });

    if (args.silent) {
        return;
    }

    console.log(`[@carno.js/client] Wrote ${result.output} (${result.routes.length} routes)`);
}

main().catch((error) => {
    console.error('[@carno.js/client]', error);
    process.exit(1);
});
