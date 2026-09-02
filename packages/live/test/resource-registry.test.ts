import { describe, expect, test } from 'bun:test';
import { Controller, Ctx, Delete, Get, Param, Query, Req } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { dependencyContext } from '../src/resource/dependency-context';
import { LiveValidationError, ResourceRegistry } from '../src/resource/ResourceRegistry';
import { directResourceExecutor } from './resource-registry-helper';

@Controller('/users')
class UsersController {
    @Get('/')
    @Live({ key: 'id' })
    list(@Query('status') status: string) {
        dependencyContext.current()?.add({ key: 'orm:users', columns: ['status'] });
        return [{ id: 1, status }];
    }

    @Get('/:id')
    @Live()
    get(@Param('id') id: string) {
        dependencyContext.current()?.add({ key: `orm:users#${id}`, columns: null });
        return { id };
    }
}

@Controller('/bad')
class WritingController {
    @Delete('/:id')
    @Live()
    remove(@Param('id') id: string) {
        return { id };
    }
}

@Controller('/bad2')
class RequestController {
    @Get('/')
    @Live()
    read(@Req() req: unknown, @Ctx() ctx: unknown) {
        return { req, ctx };
    }
}

describe('ResourceRegistry.register', () => {
    test('registers every @Live handler under controller.handler', () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController(), directResourceExecutor);

        expect(registry.ids().sort()).toEqual(['UsersController.get', 'UsersController.list']);
        expect(registry.get('UsersController.list')?.meta.key).toBe('id');
    });

    test('refuses @Live on a verb that is neither GET nor POST', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(WritingController, new WritingController(), directResourceExecutor))
            .toThrow(LiveValidationError);
    });

    test('refuses request-bound parameters that break recomputability', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(RequestController, new RequestController(), directResourceExecutor))
            .toThrow(/@Req\(\)/);
    });

    test('refuses two resources with the same id', () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController(), directResourceExecutor);

        expect(() => registry.register(UsersController, new UsersController(), directResourceExecutor))
            .toThrow(/already registered/);
    });
});

describe('ResourceRegistry.compute', () => {
    test('resolves query and param arguments from inputs', async () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController(), directResourceExecutor);

        const list = await registry.compute(registry.get('UsersController.list')!, {
            params: {},
            query: { status: 'active' }
        });
        expect(list.data).toEqual([{ id: 1, status: 'active' }]);

        const one = await registry.compute(registry.get('UsersController.get')!, {
            params: { id: '42' },
            query: {}
        });
        expect(one.data).toEqual({ id: '42' });
    });

    test('collects the dependencies registered during the compute', async () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController(), directResourceExecutor);

        const result = await registry.compute(registry.get('UsersController.get')!, {
            params: { id: '42' },
            query: {}
        });

        expect(result.deps).toEqual([{ key: 'orm:users#42', columns: null }]);
    });

    test('seeds the collector with the declared dependsOn keys', async () => {
        @Controller('/reports')
        class ReportsController {
            @Get('/')
            @Live({ dependsOn: ['app:report:current'] })
            current() {
                return { ok: true };
            }
        }

        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController(), directResourceExecutor);

        const result = await registry.compute(registry.get('ReportsController.current')!, {
            params: {},
            query: {}
        });

        expect(result.deps).toEqual([{ key: 'app:report:current', columns: null }]);
    });

    test('the collector is inactive outside a compute', () => {
        expect(dependencyContext.isActive()).toBe(false);
        expect(dependencyContext.current()).toBeUndefined();
    });

    test('concurrent computes do not mix dependencies', async () => {
        const registry = new ResourceRegistry();
        registry.register(UsersController, new UsersController(), directResourceExecutor);
        const resource = registry.get('UsersController.get')!;

        const [a, b] = await Promise.all([
            registry.compute(resource, { params: { id: '1' }, query: {} }),
            registry.compute(resource, { params: { id: '2' }, query: {} })
        ]);

        expect(a.deps).toEqual([{ key: 'orm:users#1', columns: null }]);
        expect(b.deps).toEqual([{ key: 'orm:users#2', columns: null }]);
    });
});
