import type { ViewEngine, ViewEngineOptions } from '../types';
import { interopDefault, rethrowIfPresent } from './load-module';

function unregisterPartial(handlebars: any, name: string): void {
    if (typeof handlebars.unregisterPartial === 'function') {
        handlebars.unregisterPartial(name);
        return;
    }

    if (handlebars.partials) {
        delete handlebars.partials[name];
    }
}

function applyHandlebarsRuntime(
    handlebars: any,
    registeredPartials: Set<string>,
    options?: ViewEngineOptions
): void {
    if (!options) return;

    for (const [name, helper] of Object.entries(options.helpers ?? {})) {
        handlebars.registerHelper(name, helper);
    }

    const nextPartials = options.partials ?? {};

    for (const name of Array.from(registeredPartials)) {
        if (!Object.prototype.hasOwnProperty.call(nextPartials, name)) {
            unregisterPartial(handlebars, name);
            registeredPartials.delete(name);
        }
    }

    for (const [name, source] of Object.entries(nextPartials)) {
        handlebars.registerPartial(name, source);
        registeredPartials.add(name);
    }
}

/**
 * Handlebars adapter. Layouts use `{{{body}}}` so already-rendered HTML is preserved.
 * Partials are registered from the sources the service loaded under `partials`.
 * Names missing from the current map are unregistered so cache-off reloads match disk.
 */
export function createHandlebarsEngine(): ViewEngine {
    let instance: any;
    const registeredPartials = new Set<string>();

    async function runtime(): Promise<any> {
        if (!instance) {
            let mod: any;

            try {
                mod = await import('handlebars');
            } catch (error) {
                rethrowIfPresent(error, 'handlebars', 'handlebars');
            }

            const Handlebars = interopDefault(mod);
            instance = typeof Handlebars.create === 'function' ? Handlebars.create() : Handlebars;
        }

        return instance;
    }

    return {
        name: 'handlebars',
        extensions: ['.hbs', '.handlebars'],
        async compile(source, _filename, options) {
            const handlebars = await runtime();
            applyHandlebarsRuntime(handlebars, registeredPartials, options);
            return handlebars.compile(source);
        },
        async render(template, data, options) {
            const handlebars = await runtime();
            applyHandlebarsRuntime(handlebars, registeredPartials, options);
            const fn = typeof template === 'function' ? template : handlebars.compile(String(template));
            return fn(data ?? {});
        },
    };
}
