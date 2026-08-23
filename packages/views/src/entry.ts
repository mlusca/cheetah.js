import { Carno } from '@carno.js/core';
import type { ViewsModuleOptions } from './types';
import { ViewService } from './view.service';

/**
 * Optional views plugin. Registers a configured `ViewService` singleton.
 *
 * Official engines (`handlebars`, `ejs`, `pug`) are loaded lazily on first render
 * so this factory stays synchronous.
 */
export function CarnoViews(options: ViewsModuleOptions): Carno {
    const viewService = new ViewService(options);
    const provider = { token: ViewService, useValue: viewService };

    return new Carno({
        exports: [provider],
    }).services([provider]);
}
