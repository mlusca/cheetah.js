import path from 'node:path';
import { Context, Service } from '@carno.js/core';
import { ViewForbiddenError, ViewNotFoundError } from './errors';
import {
    assertRealpathInside,
    assertSafeViewName,
    isInsideRoot,
    listFilesRecursive,
    normalizeExtensions,
    pathExists,
    readTextFile,
    resolveViewsRoot,
    toPosix,
} from './path';
import { selectViewFormat } from './negotiate';
import type {
    OfficialViewEngineName,
    ResolvedViewsOptions,
    ViewEngine,
    ViewEngineOptions,
    ViewHelper,
    ViewsModuleOptions,
} from './types';
import { isViewEngine, resolveViewEngine } from './view-engine';

interface ResolvedView {
    filename: string;
    source?: string;
}

function requireEngine(options: ViewsModuleOptions): OfficialViewEngineName | ViewEngine {
    if (!options || options.engine == null) {
        throw new Error(
            "CarnoViews requires an explicit engine: 'handlebars' | 'ejs' | 'pug' or a custom ViewEngine."
        );
    }

    if (typeof options.engine !== 'string' && !isViewEngine(options.engine)) {
        throw new Error('Custom ViewEngine must provide name, extensions, and render().');
    }

    return options.engine;
}

export function resolveViewsOptions(options: ViewsModuleOptions): ResolvedViewsOptions {
    const views = resolveViewsRoot(options.views);
    let partials: string | undefined;

    if (options.partials) {
        const resolvedPartials = path.isAbsolute(options.partials)
            ? path.resolve(options.partials)
            : path.resolve(views, options.partials);

        if (!isInsideRoot(resolvedPartials, views)) {
            throw new ViewForbiddenError();
        }

        partials = resolvedPartials;
    }

    if (options.layout) {
        assertSafeViewName(options.layout);
    }

    return {
        engine: requireEngine(options),
        views,
        cache: options.cache ?? (process.env.NODE_ENV === 'production'),
        layout: options.layout,
        partials,
        helpers: { ...(options.helpers ?? {}) },
        negotiate: {
            default: options.negotiate?.default ?? 'html',
        },
    };
}

function viewCandidates(name: string, extensions: string[]): string[] {
    const candidates: string[] = [];
    const ext = path.extname(name);
    const hasSupportedExtension = Boolean(ext) && extensions.includes(ext);

    if (hasSupportedExtension) {
        candidates.push(name);
    }

    for (const extension of extensions) {
        const withExt = name.endsWith(extension) ? name : `${name}${extension}`;
        if (!candidates.includes(withExt)) {
            candidates.push(withExt);
        }
    }

    if (candidates.length === 0) {
        candidates.push(name);
    }

    return candidates;
}

function htmlResponse(body: string, varyAccept = false): Response {
    const headers: Record<string, string> = { 'Content-Type': 'text/html' };

    if (varyAccept) {
        headers.Vary = 'Accept';
    }

    return new Response(body, { status: 200, headers });
}

function jsonResponse(data: unknown): Response {
    const response = Response.json(data ?? {});
    const headers = new Headers(response.headers);
    headers.set('Vary', 'Accept');
    return new Response(response.body, { status: response.status, headers });
}

function notAcceptableResponse(): Response {
    const response = Response.json(
        { statusCode: 406, message: 'Not Acceptable' },
        { status: 406 }
    );
    const headers = new Headers(response.headers);
    headers.set('Vary', 'Accept');
    return new Response(response.body, { status: 406, headers });
}

@Service()
export class ViewService {
    private readonly options: ResolvedViewsOptions;
    private readonly helpers: Record<string, ViewHelper>;
    private enginePromise: Promise<ViewEngine> | null = null;
    private readonly templateCache = new Map<string, unknown>();
    private readonly sourceCache = new Map<string, string>();
    private partialsCache: Record<string, string> | null = null;

    constructor(options: ViewsModuleOptions) {
        this.options = resolveViewsOptions(options);
        this.helpers = this.options.helpers;
    }

    registerHelper(name: string, helper: ViewHelper): void {
        this.helpers[name] = helper;
    }

    async html(name: string, data: Record<string, any> = {}): Promise<Response> {
        const html = await this.render(name, data);
        return htmlResponse(html);
    }

    async respond(ctx: Context, name: string, data: Record<string, any> = {}): Promise<Response> {
        const format = selectViewFormat(ctx.req.headers.get('accept'), this.options.negotiate.default);

        if (format === null) {
            return notAcceptableResponse();
        }

        if (format === 'json') {
            return jsonResponse(data);
        }

        const html = await this.render(name, data);
        return htmlResponse(html, true);
    }

    private loadEngine(): Promise<ViewEngine> {
        if (!this.enginePromise) {
            this.enginePromise = resolveViewEngine(this.options.engine);
        }

        return this.enginePromise;
    }

    private async render(name: string, data: Record<string, any>): Promise<string> {
        const engine = await this.loadEngine();
        const view = await this.resolveView(name, engine);
        const html = await this.renderFile(engine, view, data);

        if (!this.options.layout) {
            return html;
        }

        const layout = await this.resolveView(this.options.layout, engine);
        return this.renderFile(engine, layout, { ...data, body: html });
    }

    private async renderFile(
        engine: ViewEngine,
        view: ResolvedView,
        data: Record<string, any>
    ): Promise<string> {
        const options: ViewEngineOptions = {
            filename: view.filename,
            root: this.options.views,
            cache: this.options.cache,
            helpers: this.helpers,
            partials: await this.loadPartials(engine),
        };

        let template = this.options.cache ? this.templateCache.get(view.filename) : undefined;

        if (template === undefined) {
            const source = view.source ?? await this.readSource(view.filename);

            if (engine.compile) {
                template = await engine.compile(source, view.filename, options);
            } else {
                template = source;
            }

            if (this.options.cache) {
                this.templateCache.set(view.filename, template);
            }
        }

        return engine.render(template, data, options);
    }

    private async resolveView(name: string, engine: ViewEngine): Promise<ResolvedView> {
        assertSafeViewName(name);

        const extensions = normalizeExtensions(engine.extensions);
        const tried: string[] = [];

        for (const candidate of viewCandidates(name, extensions)) {
            const filename = path.resolve(this.options.views, candidate);
            tried.push(filename);

            if (!isInsideRoot(filename, this.options.views)) {
                throw new ViewForbiddenError();
            }

            if (!await pathExists(filename)) {
                continue;
            }

            await assertRealpathInside(filename, this.options.views);

            if (this.options.cache && this.templateCache.has(filename)) {
                return { filename };
            }

            return {
                filename,
                source: await this.readSource(filename),
            };
        }

        throw new ViewNotFoundError(name, tried);
    }

    private async readSource(filename: string): Promise<string> {
        if (this.options.cache) {
            const cached = this.sourceCache.get(filename);
            if (cached !== undefined) {
                return cached;
            }
        }

        const source = await readTextFile(filename);

        if (this.options.cache) {
            this.sourceCache.set(filename, source);
        }

        return source;
    }

    private async loadPartials(engine: ViewEngine): Promise<Record<string, string>> {
        if (!this.options.partials) {
            return {};
        }

        if (this.options.cache && this.partialsCache) {
            return this.partialsCache;
        }

        const extensions = normalizeExtensions(engine.extensions);
        const partials: Record<string, string> = {};

        if (!await pathExists(this.options.partials)) {
            if (this.options.cache) {
                this.partialsCache = partials;
            }
            return partials;
        }

        await assertRealpathInside(this.options.partials, this.options.views);

        for (const filePath of await listFilesRecursive(this.options.partials)) {
            const ext = path.extname(filePath);
            if (extensions.length > 0 && !extensions.includes(ext)) {
                continue;
            }

            if (!isInsideRoot(filePath, this.options.views)) {
                throw new ViewForbiddenError();
            }

            await assertRealpathInside(filePath, this.options.views);

            const relative = toPosix(path.relative(this.options.partials, filePath));
            const name = relative.slice(0, relative.length - ext.length);
            partials[name] = await this.readSource(filePath);
        }

        if (this.options.cache) {
            this.partialsCache = partials;
        }

        return partials;
    }
}
