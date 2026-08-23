import { Controller, Get, Ctx, Context } from '@carno.js/core';
import { getMimeType } from './MimeTypes';
import { isSafePath, isSpaNavigablePath } from './utils';
import { getStaticConfig, getCachedFileResponse, isProductionMode } from './config';
import type { ResolvedConfig } from './types';
import * as path from 'path';

// Re-export token for convenience
export { STATIC_CONFIG_TOKEN } from './config';

/**
 * Dynamic static file controller (development mode).
 * Uses wildcard route to serve files on-demand.
 * 
 * In production mode (alwaysStatic: true), files are pre-loaded
 * and served from memory cache for maximum performance.
 */
@Controller()
export class StaticController {
    @Get('/*')
    async serve(@Ctx() ctx: Context): Promise<Response> {
        const config = getStaticConfig();

        // Extract path from URL (remove prefix)
        let requestPath = ctx.path;
        if (config.prefix !== '/') {
            if (!requestPath.startsWith(config.prefix)) {
                return new Response('Not Found', { status: 404 });
            }
            requestPath = requestPath.slice(config.prefix.length) || '/';
        }

        // Clean path - remove query string
        const cleanPath = requestPath.split('?')[0];

        // Production mode: Try cache first
        if (isProductionMode()) {
            const cached = getCachedFileResponse(cleanPath);
            if (cached) {
                // Clone response to allow multiple reads
                return cached.clone();
            }
        }

        // Development mode or cache miss: Serve dynamically
        const filePath = path.join(config.root, cleanPath);

        // Security: Prevent path traversal
        if (!isSafePath(filePath, config.root)) {
            return new Response('Forbidden', { status: 403 });
        }

        // Check dotfiles
        if (!config.dotFiles) {
            const parts = cleanPath.split('/');
            if (parts.some(p => p.startsWith('.') && p !== '.')) {
                return new Response('Forbidden', { status: 403 });
            }
        }

        // Check extensions whitelist
        if (config.extensions.length > 0) {
            const ext = path.extname(filePath).slice(1).toLowerCase();
            if (ext && !config.extensions.includes(ext)) {
                return new Response('Forbidden', { status: 403 });
            }
        }

        // Try to serve file
        const file = Bun.file(filePath);
        if (await file.exists()) {
            const stat = await file.stat();

            // If directory, try index files
            if (stat.isDirectory()) {
                const indexResult = await this.tryIndexFiles(filePath, config);
                if (indexResult) return indexResult;
                return new Response('Not Found', { status: 404 });
            }

            return this.serveFile(file, filePath, config);
        }

        // Try index files if path looks like a directory
        if (!path.extname(filePath)) {
            const indexResult = await this.tryIndexFiles(filePath, config);
            if (indexResult) return indexResult;
        }

        // SPA fallback: serve index.html for browser routes, not assets or /api
        if (config.spa && isSpaNavigablePath(ctx.path)) {
            const indexPath = path.join(
                config.root,
                Array.isArray(config.index) ? config.index[0] : config.index
            );

            // Try cache first in production
            if (isProductionMode()) {
                const indexCachePath = '/' + (Array.isArray(config.index) ? config.index[0] : config.index);
                const cached = getCachedFileResponse(indexCachePath);
                if (cached) return cached.clone();
            }

            const indexFile = Bun.file(indexPath);
            if (await indexFile.exists()) {
                return this.serveFile(indexFile, indexPath, config);
            }
        }

        return new Response('Not Found', { status: 404 });
    }

    private async tryIndexFiles(
        dirPath: string,
        config: ResolvedConfig
    ): Promise<Response | null> {
        const indexFiles = Array.isArray(config.index) ? config.index : [config.index];

        for (const indexFile of indexFiles) {
            const indexPath = path.join(dirPath, indexFile);
            const file = Bun.file(indexPath);

            if (await file.exists()) {
                return this.serveFile(file, indexPath, config);
            }
        }

        return null;
    }

    private serveFile(
        file: ReturnType<typeof Bun.file>,
        filePath: string,
        config: ResolvedConfig
    ): Response {
        const headers: Record<string, string> = {
            'Content-Type': getMimeType(filePath)
        };

        if (config.cacheControl) {
            headers['Cache-Control'] = config.cacheControl;
        }

        return new Response(file, { headers });
    }
}
