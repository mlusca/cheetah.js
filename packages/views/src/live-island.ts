/**
 * A prefetched live resource, as a template receives it.
 *
 * Declared structurally rather than imported from `@carno.js/live`: a views
 * application with no islands must not acquire a dependency on the live
 * package to render a page.
 */
export interface IslandPayload {
    resourceId: string;
    inputs: unknown;
    data: unknown;
    hash: string;
}

/**
 * Three sequences an HTML parser acts on even inside a script element.
 *
 * `</script` ends the element -- everything after it becomes markup, and the
 * data came from the database. `<!--` and `<script` shift the parser into a
 * state where the first two of those stop working. Escaping the slash and the
 * angle bracket keeps the JSON valid: both are legal escapes in a JSON string.
 */
function escapeForScript(json: string): string {
    return json
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '\\u003c!--')
        .replace(/<script/gi, '\\u003cscript');
}

/**
 * Serialise prefetched live resources into the page.
 *
 * Register it as a view helper and call it where the island renders; the
 * client's `readHydrationPayload()` collects every one of these and starts the
 * store full, so the island paints with the same data the rest of the page
 * was rendered from and its subscription carries only a hash.
 *
 * There is no island runtime here, and there should not be one: the template
 * decides what is an island.
 */
export function liveIsland(payload: IslandPayload | IslandPayload[]): string {
    const payloads = Array.isArray(payload) ? payload : [payload];

    return payloads
        .map(entry =>
            `<script type="application/json" data-carno-live>${escapeForScript(JSON.stringify(entry))}</script>`
        )
        .join('');
}
