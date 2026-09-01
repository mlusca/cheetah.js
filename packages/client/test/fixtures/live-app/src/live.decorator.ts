/**
 * Stand-in for @carno.js/live's @Live(). The scanner matches decorators by
 * name, so the fixture does not have to depend on the live package — which
 * would drag the websocket and orm packages into this program for nothing.
 */
export function Live(options?: {
    key?: string;
    shared?: 'private' | 'tenant' | 'public';
    dependsOn?: string[];
}): MethodDecorator {
    void options;
    return () => {};
}
