import { afterAll, beforeAll, describe, test } from 'bun:test';
import { Controller, Get, Post, Body, Param, Query, Use } from '../../src';
import type { CarnoMiddleware, CarnoClosure } from '../../src';
import type { Context } from '../../src';
import { createTestHarness, type TestHarness } from '../../src/testing/TestHarness';
import { bench, logResult, readBaseline, writeBaseline, compare, type BenchResult } from './_perf-helper';

class PassMiddleware implements CarnoMiddleware {
  async handle(_ctx: Context, next: CarnoClosure) {
    return next();
  }
}

@Controller('/users')
class PerfUserController {
  @Get('/:id')
  getOne(@Param('id') id: string) {
    return { id, name: 'User ' + id };
  }

  @Get()
  list(@Query('q') q: string) {
    return { q: q ?? '', items: [1, 2, 3, 4, 5] };
  }

  @Post()
  create(@Body() body: any) {
    return { created: true, data: body };
  }
}

@Controller('/heavy')
@Use(PassMiddleware, PassMiddleware, PassMiddleware, PassMiddleware, PassMiddleware)
class PerfHeavyController {
  @Get('/:id')
  withMiddleware(@Param('id') id: string) {
    return { id };
  }
}

const SUITE = 'baseline';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';

describe('Core Performance Baseline', () => {
  const results: BenchResult[] = [];
  let harness: TestHarness;
  let baseUrl: string;

  beforeAll(async () => {
    harness = await createTestHarness({
      controllers: [PerfUserController, PerfHeavyController],
      services: [PassMiddleware],
      listen: true,
    });
    baseUrl = `http://127.0.0.1:${harness.port}`;
  });

  afterAll(async () => {
    const baseline = readBaseline(SUITE);
    if (baseline) {
      for (const r of results) {
        const prev = baseline.results[r.name];
        if (!prev) continue;
        compare(r.name, prev.avgMs, r.avgMs);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`[perf] No baseline stored for suite=${SUITE}. Run with RECORD_BASELINE=1 to create one.`);
    }

    if (RECORD_BASELINE) {
      writeBaseline(SUITE, results);
      // eslint-disable-next-line no-console
      console.log(`[perf] Baseline saved for suite=${SUITE}`);
    }

    await harness.close();
  });

  test('GET /users/:id (route + 1 param) x 500', async () => {
    const r = await bench('get-by-id', async () => {
      const res = await fetch(`${baseUrl}/users/42`);
      await res.text();
    }, { iterations: 500, warmup: 50 });
    results.push(r);
    logResult(r);
  });

  test('GET /users?q=foo (query parsing) x 500', async () => {
    const r = await bench('get-with-query', async () => {
      const res = await fetch(`${baseUrl}/users?q=foo&page=2`);
      await res.text();
    }, { iterations: 500, warmup: 50 });
    results.push(r);
    logResult(r);
  });

  test('POST /users (json body) x 300', async () => {
    const r = await bench('post-json', async () => {
      const res = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name":"x","age":30}',
      });
      await res.text();
    }, { iterations: 300, warmup: 30 });
    results.push(r);
    logResult(r);
  });

  test('GET /heavy/:id (5 middlewares) x 300', async () => {
    const r = await bench('middleware-chain', async () => {
      const res = await fetch(`${baseUrl}/heavy/7`);
      await res.text();
    }, { iterations: 300, warmup: 30 });
    results.push(r);
    logResult(r);
  });
});
