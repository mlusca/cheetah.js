import { Controller, Get } from '@carno.js/core';

function dynamicPath(): string {
    return '/dynamic';
}

@Controller('/skip')
export class DynamicController {
    @Get(dynamicPath())
    hidden(): string {
        return 'nope';
    }

    @Get('/visible')
    visible(): { visible: true } {
        return { visible: true };
    }
}
