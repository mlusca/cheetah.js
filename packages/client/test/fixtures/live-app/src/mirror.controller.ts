import { Controller, Get } from '@carno.js/core';
import { Live } from './live.decorator';
import type { Card } from './dto';

@Controller('/mirror')
export class BoardController {
    @Get()
    @Live({ key: 'id' })
    list(): Card[] {
        return [];
    }
}
