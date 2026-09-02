import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    Body,
    Carno,
    Context,
    Controller,
    Ctx,
    Post,
    Schema,
    Use,
    ZodAdapter,
    type MiddlewareHandler
} from '../src';
import { withTestApp } from '../src/testing/TestHarness';

@Schema(z.object({ name: z.string().min(2) }))
class CreateGreetingDto {
    name!: string;
}

describe('compiled route executor', () => {
    test('reuses middleware order and DTO validation outside Bun.serve', async () => {
        const steps: string[] = [];
        const globalMiddleware: MiddlewareHandler = () => {
            steps.push('global');
        };
        const controllerMiddleware: MiddlewareHandler = () => {
            steps.push('controller');
        };
        const routeMiddleware: MiddlewareHandler = () => {
            steps.push('route');
        };

        @Controller('/greetings')
        @Use(controllerMiddleware)
        class GreetingController {
            @Post('/create')
            @Use(routeMiddleware)
            create(@Body() dto: CreateGreetingDto, @Ctx() ctx: Context) {
                steps.push('handler');
                return { greeting: `Hello, ${dto.name}`, steps: ctx.locals.steps ?? steps };
            }
        }

        await withTestApp(
            async harness => {
                const valid = await harness.app.executeCompiledRoute(
                    GreetingController,
                    'create',
                    new Request('http://carno.test/greetings/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: 'Ada' })
                    })
                );

                expect(valid.status).toBe(200);
                expect(await valid.json()).toEqual({
                    greeting: 'Hello, Ada',
                    steps: ['global', 'controller', 'route', 'handler']
                });

                await expect(harness.app.executeCompiledRoute(
                    GreetingController,
                    'create',
                    new Request('http://carno.test/greetings/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: 'A' })
                    })
                )).rejects.toThrow(/Validation failed/);
            },
            {
                controllers: [GreetingController],
                config: {
                    globalMiddlewares: [globalMiddleware],
                    validation: new ZodAdapter()
                },
                listen: true
            }
        );
    });
});
