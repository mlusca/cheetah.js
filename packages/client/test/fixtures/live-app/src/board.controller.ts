import { Body, Controller, Get, Param, Post, Query } from '@carno.js/core';
import { Live } from './live.decorator';
import type { Card, CardFilter } from './dto';

@Controller('/cards')
export class BoardController {
    @Get()
    @Live({ key: 'id', shared: 'tenant' })
    list(@Query('status') status?: string): Card[] {
        void status;
        return [];
    }

    @Get('/:id')
    @Live()
    byId(@Param('id') id: string): Card {
        return { id, title: '', done: false };
    }

    @Post('/search')
    @Live({ key: 'id' })
    search(@Body() filter: CardFilter): Card[] {
        void filter;
        return [];
    }

    @Post()
    create(@Body() card: Card): Card {
        return card;
    }
}
