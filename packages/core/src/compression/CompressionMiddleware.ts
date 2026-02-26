import type { Context } from '../context/Context';
import type { CarnoMiddleware, CarnoClosure } from '../middleware/CarnoMiddleware';
import { brotliCompressSync, constants } from 'zlib';

type GzipLevel = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type BrotliQuality = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/**
 * Compression configuration.
 */
export interface CompressionConfig {
  /**
   * Minimum response size in bytes to trigger compression.
   * Responses smaller than this are sent uncompressed.
   * @default 1024
   */
  threshold?: number;

  /**
   * Preferred encoding order. Client's Accept-Encoding is matched against this list.
   * @default ['br', 'gzip']
   */
  encodings?: ('br' | 'gzip' | 'deflate')[];

  /**
   * Content-Type patterns that should be compressed.
   * Matched using string includes (case-insensitive).
   * @default ['text/', 'application/json', 'application/javascript', 'application/xml', 'image/svg+xml']
   */
  compressibleTypes?: string[];

  /**
   * Brotli compression quality (0-11). Higher = better compression, slower.
   * @default 4
   */
  brotliQuality?: BrotliQuality;

  /**
   * Gzip compression level (-1 to 9). Higher = better compression, slower.
   * @default 6
   */
  gzipLevel?: GzipLevel;
}

const DEFAULT_THRESHOLD = 1024;
const DEFAULT_ENCODINGS: ('br' | 'gzip' | 'deflate')[] = ['br', 'gzip'];
const DEFAULT_COMPRESSIBLE_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/xhtml+xml',
  'image/svg+xml',
];
const DEFAULT_BROTLI_QUALITY: BrotliQuality = 4;
const DEFAULT_GZIP_LEVEL: GzipLevel = 6;

type CompressFn = (data: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

/**
 * Compression middleware for Carno.
 *
 * Supports **gzip**, **brotli** and **deflate** using Bun's native APIs
 * (zero external dependencies).
 *
 * Does NOT touch the hot path — runs entirely as a middleware in the
 * onion chain. Routes without middleware remain untouched.
 *
 * All configuration is resolved once at construction time (startup)
 * so the per-request overhead is minimal: one header check +
 * one compression call for eligible responses.
 *
 * @example
 * ```ts
 * import { Carno, CompressionMiddleware } from '@carno.js/core';
 *
 * const app = new Carno()
 *   .middlewares([new CompressionMiddleware()])
 *   .controllers([MyController]);
 *
 * app.listen(3000);
 * ```
 *
 * @example Custom configuration:
 * ```ts
 * new CompressionMiddleware({
 *   threshold: 512,
 *   encodings: ['gzip'],
 *   gzipLevel: 9,
 * })
 * ```
 */
export class CompressionMiddleware implements CarnoMiddleware {
  private readonly threshold: number;
  private readonly compressibleTypes: string[];
  private readonly compressors: Map<string, CompressFn>;
  private readonly encodingOrder: string[];

  constructor(config?: CompressionConfig) {
    this.threshold = config?.threshold ?? DEFAULT_THRESHOLD;
    this.compressibleTypes = (config?.compressibleTypes ?? DEFAULT_COMPRESSIBLE_TYPES)
      .map(t => t.toLowerCase());

    const encodings = config?.encodings ?? DEFAULT_ENCODINGS;
    this.encodingOrder = encodings;

    const brotliQuality = config?.brotliQuality ?? DEFAULT_BROTLI_QUALITY;
    const gzipLevel = config?.gzipLevel ?? DEFAULT_GZIP_LEVEL;

    // Pre-build compressor functions at construction time (startup only)
    this.compressors = new Map();

    for (const enc of encodings) {
      switch (enc) {
        case 'br':
          this.compressors.set('br', (data: Uint8Array<ArrayBuffer>) => {
            const buf = brotliCompressSync(data, {
              params: { [constants.BROTLI_PARAM_QUALITY]: brotliQuality },
            });
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          });
          break;
        case 'gzip':
          this.compressors.set('gzip', (data: Uint8Array<ArrayBuffer>) =>
            Bun.gzipSync(data, { level: gzipLevel }),
          );
          break;
        case 'deflate':
          this.compressors.set('deflate', (data: Uint8Array<ArrayBuffer>) =>
            Bun.deflateSync(data),
          );
          break;
      }
    }
  }

  async handle(ctx: Context, next: CarnoClosure): Promise<Response | void> {
    const response = await next();

    // Fast-exit: no Accept-Encoding header
    const acceptEncoding = ctx.req.headers.get('accept-encoding');
    if (!acceptEncoding) {
      return response;
    }

    // Already encoded — skip
    if (response.headers.get('content-encoding')) {
      return response;
    }

    // Non-compressible content type — skip
    const contentType = response.headers.get('content-type');
    if (!contentType || !this.isCompressible(contentType)) {
      return response;
    }

    // Negotiate encoding
    const encoding = this.negotiateEncoding(acceptEncoding);
    if (!encoding) {
      return response;
    }

    // Read body bytes (consumes the response body)
    const buffer = await response.arrayBuffer();

    // Below threshold — reconstruct original response
    if (buffer.byteLength < this.threshold) {
      return new Response(buffer, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const compressor = this.compressors.get(encoding)!;
    const bodyBytes = new Uint8Array(buffer);
    const compressed = compressor(bodyBytes);

    // If compressed is not smaller, return original uncompressed
    if (compressed.byteLength >= buffer.byteLength) {
      return new Response(buffer, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const headers = new Headers(response.headers);
    headers.set('Content-Encoding', encoding);
    headers.set('Content-Length', String(compressed.byteLength));
    headers.set('Vary', this.buildVaryHeader(headers.get('Vary')));

    return new Response(compressed, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private isCompressible(contentType: string): boolean {
    const lower = contentType.toLowerCase();
    for (const pattern of this.compressibleTypes) {
      if (lower.includes(pattern)) return true;
    }
    return false;
  }

  private negotiateEncoding(acceptEncoding: string): string | null {
    const lower = acceptEncoding.toLowerCase();
    for (const encoding of this.encodingOrder) {
      if (lower.includes(encoding)) return encoding;
    }
    return null;
  }

  private buildVaryHeader(existing: string | null): string {
    if (!existing) return 'Accept-Encoding';
    if (existing.toLowerCase().includes('accept-encoding')) return existing;
    return `${existing}, Accept-Encoding`;
  }
}
