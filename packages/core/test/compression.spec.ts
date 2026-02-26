import { describe, it, expect } from 'bun:test';
import { Controller, Get, Context, Service } from '../src';
import { withTestApp } from '../src/testing/TestHarness';
import { CompressionMiddleware } from '../src/compression/CompressionMiddleware';
import { gunzipSync } from 'zlib';

// Large JSON payload that exceeds default 1024-byte threshold
const LARGE_PAYLOAD = { items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}`, description: 'A'.repeat(50) })) };
const SMALL_PAYLOAD = { ok: true };

describe('CompressionMiddleware', () => {
  @Controller('/test')
  class TestController {
    @Get('/large')
    large() {
      return LARGE_PAYLOAD;
    }

    @Get('/small')
    small() {
      return SMALL_PAYLOAD;
    }

    @Get('/text')
    text(ctx: Context) {
      return ctx.text('A'.repeat(2000));
    }

    @Get('/html')
    html(ctx: Context) {
      return ctx.html('<html>' + '<p>hello</p>'.repeat(200) + '</html>');
    }

    @Get('/empty')
    empty() {
      return undefined;
    }
  }

  it('should compress large JSON with gzip when Accept-Encoding: gzip', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('gzip');
        expect(response.headers.get('vary')).toContain('Accept-Encoding');

        // fetch() auto-decompresses — verify body is intact
        const json = await response.json();
        expect(json.items.length).toBe(100);
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware({ encodings: ['gzip'] })],
        },
        listen: true,
      },
    );
  });

  it('should compress large JSON with brotli when Accept-Encoding: br', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'br' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('br');
        expect(response.headers.get('vary')).toContain('Accept-Encoding');
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware()],
        },
        listen: true,
      },
    );
  });

  it('should prefer brotli over gzip by default', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'gzip, br, deflate' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('br');
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware()],
        },
        listen: true,
      },
    );
  });

  it('should NOT compress responses below threshold', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/small', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBeNull();

        const json = await response.json();
        expect(json).toEqual(SMALL_PAYLOAD);
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware()],
        },
        listen: true,
      },
    );
  });

  it('should NOT compress when unsupported Accept-Encoding', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'identity' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBeNull();
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware()],
        },
        listen: true,
      },
    );
  });

  it('should compress text/plain responses', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/text', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('gzip');
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware({ encodings: ['gzip'] })],
        },
        listen: true,
      },
    );
  });

  it('should compress text/html responses', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/html', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('gzip');
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware({ encodings: ['gzip'] })],
        },
        listen: true,
      },
    );
  });

  it('should respect custom threshold', async () => {
    await withTestApp(
      async (harness) => {
        // With very high threshold, nothing gets compressed
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBeNull();
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware({ threshold: 1_000_000 })],
        },
        listen: true,
      },
    );
  });

  it('should support deflate encoding', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'deflate' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('deflate');
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware({ encodings: ['deflate'] })],
        },
        listen: true,
      },
    );
  });

  it('should handle 204 No Content (empty body) gracefully', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/empty', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('content-encoding')).toBeNull();
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware()],
        },
        listen: true,
      },
    );
  });

  it('should set Content-Encoding and preserve data integrity', async () => {
    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test/large', {
          headers: { 'Accept-Encoding': 'gzip' },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-encoding')).toBe('gzip');

        // Content-Length header reflects compressed size (smaller than original)
        const contentLength = Number(response.headers.get('content-length'));
        expect(contentLength).toBeGreaterThan(0);

        // fetch() auto-decompresses, verify JSON integrity
        const json = await response.json();
        expect(json.items.length).toBe(100);
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [new CompressionMiddleware({ encodings: ['gzip'] })],
        },
        listen: true,
      },
    );
  });
});
