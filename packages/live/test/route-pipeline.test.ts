import { afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    Body,
    Controller,
    Get,
    Post,
    Schema,
    Use,
    type MiddlewareHandler
} from '@carno.js/core';
import { createTestHarness } from '@carno.js/core';
import { closeLiveRuntime, Live, LivePlugin, LiveService } from '../src';

let controllerCalls = 0;
const pipelineSteps: string[] = [];

const allowHeader: MiddlewareHandler = ctx => {
    pipelineSteps.push('global');

    if (ctx.headers.get('x-allow') !== 'yes') {
        return new Response('forbidden', { status: 403 });
    }
};

function nativeFetch(input: string, init?: RequestInit): Promise<Response> {
    const fetchImpl = (globalThis as { __carnoNativeFetch?: typeof fetch }).__carnoNativeFetch ?? fetch;
    return fetchImpl(input, init);
}

@Controller('/guarded')
@Use(ctx => {
    pipelineSteps.push('controller');
    ctx.locals.controller = true;
})
class GuardedController {
    @Get('/')
    @Use(ctx => {
        pipelineSteps.push('route');
        ctx.locals.route = true;
    })
    @Live({ shared: 'public' })
    read() {
        pipelineSteps.push('handler');
        controllerCalls += 1;
        return { ok: true };
    }
}

@Schema(z.object({ name: z.string().min(2) }))
class GreetingDto {
    name!: string;
}

@Controller('/greetings')
class GreetingController {
    @Post('/search')
    @Live({ shared: 'public' })
    search(@Body() dto: GreetingDto) {
        controllerCalls += 1;
        return { greeting: `Hello, ${dto.name}` };
    }
}

afterEach(async () => {
    controllerCalls = 0;
    pipelineSteps.length = 0;
    await closeLiveRuntime();
});

describe('Live route pipeline', () => {
    test('prefetch executes middleware and fails closed without route credentials', async () => {
        const harness = await createTestHarness({
            plugins: [LivePlugin.create({
                controllers: [GuardedController],
                config: { coalesceMs: 1 }
            })],
            config: { globalMiddlewares: [allowHeader] },
            listen: true
        });

        try {
            const http = await nativeFetch(`http://127.0.0.1:${harness.port}/guarded`, {
                headers: { 'x-allow': 'no' }
            });
            expect(http.status).toBe(403);

            const live = harness.resolve(LiveService);
            await expect(live.prefetch('GuardedController.read')).rejects.toThrow(/403|forbidden/i);
            expect(controllerCalls).toBe(0);

            pipelineSteps.length = 0;
            const payload = await live.prefetch(
                'GuardedController.read',
                {},
                { headers: { 'x-allow': 'yes' } }
            );

            expect(payload.data).toEqual({ ok: true });
            expect(controllerCalls).toBe(1);
            expect(pipelineSteps).toEqual(['global', 'controller', 'route', 'handler']);
        } finally {
            await harness.close();
        }
    });

    test('prefetch applies the same DTO validation as the POST route', async () => {
        const harness = await createTestHarness({
            plugins: [LivePlugin.create({
                controllers: [GreetingController],
                config: { coalesceMs: 1 }
            })],
            config: { globalMiddlewares: [allowHeader] },
            listen: true
        });

        try {
            const http = await nativeFetch(`http://127.0.0.1:${harness.port}/greetings/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-allow': 'yes'
                },
                body: JSON.stringify({ name: 'A' })
            });
            expect(http.status).toBe(400);

            const live = harness.resolve(LiveService);
            await expect(live.prefetch(
                'GreetingController.search',
                { body: { name: 'A' } },
                { headers: { 'x-allow': 'yes' } }
            )).rejects.toThrow(/Validation failed/);
            expect(controllerCalls).toBe(0);
        } finally {
            await harness.close();
        }
    });
});
