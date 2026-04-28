import fs from 'fs';
import path from 'path';

export type BenchResult = {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  opsPerSec: number;
};

export type BenchOptions = {
  iterations?: number;
  warmup?: number;
  perIteration?: boolean;
};

export async function bench(
  name: string,
  fn: () => Promise<unknown> | unknown,
  options: BenchOptions = {},
): Promise<BenchResult> {
  const iterations = options.iterations ?? 100;
  const warmup = options.warmup ?? Math.min(10, Math.floor(iterations / 10));
  const perIteration = options.perIteration ?? true;

  for (let i = 0; i < warmup; i += 1) {
    await fn();
  }

  const samples: number[] = [];
  let totalMs = 0;

  if (perIteration) {
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      await fn();
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      totalMs += elapsed;
    }
  } else {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      await fn();
    }
    totalMs = performance.now() - start;
  }

  const sorted = samples.slice().sort((a, b) => a - b);
  const p = (q: number) => sorted.length === 0
    ? totalMs / iterations
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

  const avgMs = totalMs / iterations;

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    opsPerSec: iterations / (totalMs / 1000),
  };
}

export function compare(label: string, baselineMs: number, currentMs: number): number {
  const delta = ((currentMs - baselineMs) / baselineMs) * 100;
  const arrow = delta < 0 ? '⬇ faster' : delta > 0 ? '⬆ slower' : '=';
  // eslint-disable-next-line no-console
  console.log(`[perf] ${label}: baseline=${baselineMs.toFixed(3)}ms current=${currentMs.toFixed(3)}ms Δ=${delta.toFixed(2)}% ${arrow}`);
  return delta;
}

const BASELINE_DIR = path.resolve(__dirname, '.baselines');

export type BaselineRecord = {
  results: Record<string, Pick<BenchResult, 'avgMs' | 'p50' | 'p95' | 'p99' | 'opsPerSec' | 'iterations'>>;
  recordedAt: string;
};

function ensureBaselineDir() {
  if (!fs.existsSync(BASELINE_DIR)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
  }
}

export function readBaseline(suite: string): BaselineRecord | undefined {
  const file = path.join(BASELINE_DIR, `${suite}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as BaselineRecord;
  } catch {
    return undefined;
  }
}

export function writeBaseline(suite: string, results: BenchResult[]): void {
  ensureBaselineDir();
  const file = path.join(BASELINE_DIR, `${suite}.json`);
  const record: BaselineRecord = {
    recordedAt: new Date().toISOString(),
    results: Object.fromEntries(
      results.map((r) => [r.name, {
        iterations: r.iterations,
        avgMs: r.avgMs,
        p50: r.p50,
        p95: r.p95,
        p99: r.p99,
        opsPerSec: r.opsPerSec,
      }]),
    ),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
}

export function logResult(r: BenchResult) {
  // eslint-disable-next-line no-console
  console.log(
    `[perf] ${r.name} | iters=${r.iterations} avg=${r.avgMs.toFixed(3)}ms p50=${r.p50.toFixed(3)}ms p95=${r.p95.toFixed(3)}ms p99=${r.p99.toFixed(3)}ms ops/s=${r.opsPerSec.toFixed(0)}`,
  );
}
