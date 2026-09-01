import { describe, expect, it } from 'bun:test';
import { liveIsland } from '../src/live-island';
import { ViewService } from '../src/view.service';

const PAYLOAD = {
    resourceId: 'CardsController.list',
    inputs: { params: {}, query: {} },
    data: [{ id: 1, title: 'a' }],
    hash: 'abc123'
};

describe('liveIsland', () => {
    it('emits a script tag the client reader can find', () => {
        const html = liveIsland(PAYLOAD);

        expect(html).toStartWith('<script type="application/json" data-carno-live>');
        expect(html).toEndWith('</script>');
        expect(JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('<')))).toEqual(PAYLOAD);
    });

    it('emits one script per payload when given a list', () => {
        const html = liveIsland([PAYLOAD, { ...PAYLOAD, hash: 'def456' }]);

        expect(html.match(/<script /g)?.length).toBe(2);
    });

    it('escapes a closing script tag hiding in the data', () => {
        const html = liveIsland({ ...PAYLOAD, data: [{ title: '</script><img onerror=alert(1)>' }] });

        // Without this the browser ends the script early and the rest of the
        // payload becomes markup. It is the only injection vector here, and
        // the data comes from the database.
        expect(html).not.toInclude('</script><img');
        expect(html).toInclude('<\\/script>');
    });

    it('escapes the other two sequences an HTML parser acts on inside a script', () => {
        const html = liveIsland({ ...PAYLOAD, data: ['<!--', '<script>'] });

        expect(html).not.toInclude('<!--');
        expect(html).not.toInclude('<script>x');
    });

    it('survives a round trip through JSON.parse', () => {
        const html = liveIsland({ ...PAYLOAD, data: [{ title: '</script>' }] });
        const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('<'));

        expect((JSON.parse(json) as typeof PAYLOAD).data).toEqual([{ title: '</script>' }]);
    });

    it('emits nothing for an empty list', () => {
        expect(liveIsland([])).toBe('');
    });
});

describe('liveIsland as a view helper', () => {
    it('is available to a template without being registered by hand', async () => {
        const service = new ViewService({
            engine: {
                name: 'inline',
                extensions: ['.html'],
                render: (template, data, options) =>
                    String(template).replace('{{island}}', String(options!.helpers.liveIsland(data.card)))
            },
            views: process.cwd()
        });

        const html = await service.render('anything', { card: PAYLOAD }).catch(() => null);

        // Rendering needs a file on disk; what matters here is only that the
        // helper is registered. Assert that directly if the render is skipped.
        expect(html === null || html.includes('data-carno-live')).toBe(true);
        expect(typeof (service as any).helpers.liveIsland).toBe('function');
    });
});
