import type { OfficialViewEngineName, ViewEngine } from './types';


export function isViewEngine(value: unknown): value is ViewEngine {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const engine = value as ViewEngine;
    return typeof engine.name === 'string'
        && Array.isArray(engine.extensions)
        && typeof engine.render === 'function';
}

/**
 * Resolve a configured engine without loading unselected official libraries.
 * Official packages are imported lazily inside each engine's compile/render.
 */
export async function resolveViewEngine(engine: OfficialViewEngineName | ViewEngine): Promise<ViewEngine> {
    if (isViewEngine(engine)) {
        return engine;
    }

    if (engine === 'handlebars') {
        const { createHandlebarsEngine } = await import('./engines/handlebars.engine');
        return createHandlebarsEngine();
    }

    if (engine === 'ejs') {
        const { createEjsEngine } = await import('./engines/ejs.engine');
        return createEjsEngine();
    }

    if (engine === 'pug') {
        const { createPugEngine } = await import('./engines/pug.engine');
        return createPugEngine();
    }

    throw new Error(
        `Unknown view engine "${String(engine)}". Use 'handlebars', 'ejs', 'pug', or a custom ViewEngine.`
    );
}
