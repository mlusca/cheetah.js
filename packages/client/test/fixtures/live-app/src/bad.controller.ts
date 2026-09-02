import { Controller, Ctx, Get, Header, Put, Query, Req } from '@carno.js/core';
import { Live } from './live.decorator';
import type { Card } from './dto';

@Controller('/bad')
export class BadController {
    @Put('/:id')
    @Live()
    replace(): Card {
        return { id: '1', title: '', done: false };
    }

    @Get('/request')
    @Live()
    withRequest(@Req() req: unknown, @Ctx() ctx: unknown): Card {
        void req;
        void ctx;
        return { id: '1', title: '', done: false };
    }

    @Get('/header')
    @Live()
    withHeader(@Header('x-tenant') tenant: string): Card {
        void tenant;
        return { id: '1', title: '', done: false };
    }

    @Get('/unserializable')
    @Live()
    withDate(@Query('since') since: Date): Card {
        void since;
        return { id: '1', title: '', done: false };
    }

    @Get('/needs-key')
    @Live()
    needsKey(): Card[] {
        return [];
    }
}
