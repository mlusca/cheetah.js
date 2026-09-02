import { describe, expect, test } from 'bun:test';
import { Body, Controller, Get, Post, Query } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { LiveValidationError, ResourceRegistry } from '../src/resource/ResourceRegistry';
import { directResourceExecutor } from './resource-registry-helper';

interface ReportFilter {
    status: string;
    limit: number;
}

@Controller('/reports')
class ReportsController {
    @Post('/search')
    @Live({ key: 'id' })
    search(@Body() filter: ReportFilter) {
        return [{ id: 1, status: filter.status, limit: filter.limit }];
    }

    @Post('/by-status')
    @Live()
    byStatus(@Body('status') status: string) {
        return { status };
    }
}

@Controller('/bad-get-body')
class GetWithBodyController {
    @Get('/')
    @Live()
    read(@Body() filter: unknown) {
        return filter;
    }
}

describe('@Live() on @Post()', () => {
    test('registers a POST handler as a live resource', () => {
        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController(), directResourceExecutor);

        expect(registry.ids().sort()).toEqual([
            'ReportsController.byStatus',
            'ReportsController.search'
        ]);
    });

    test('binds the whole body to a bare @Body()', async () => {
        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController(), directResourceExecutor);

        const resource = registry.get('ReportsController.search')!;
        const { data } = await registry.compute(resource, {
            params: {},
            query: {},
            body: { status: 'open', limit: 10 }
        });

        expect(data).toEqual([{ id: 1, status: 'open', limit: 10 }]);
    });

    test('binds one field to @Body(key)', async () => {
        const registry = new ResourceRegistry();
        registry.register(ReportsController, new ReportsController(), directResourceExecutor);

        const resource = registry.get('ReportsController.byStatus')!;
        const { data } = await registry.compute(resource, {
            params: {},
            query: {},
            body: { status: 'closed' }
        });

        expect(data).toEqual({ status: 'closed' });
    });

    test('refuses @Body() on a live @Get()', () => {
        const registry = new ResourceRegistry();

        expect(() => registry.register(GetWithBodyController, new GetWithBodyController(), directResourceExecutor))
            .toThrow(/carries no body/);
    });
});
