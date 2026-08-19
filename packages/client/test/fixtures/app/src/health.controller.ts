import { Controller, Get } from '@carno.js/core';
import { ApiUsers, HealthPath } from './routes';

@Controller(HealthPath)
export class HealthController {
    @Get()
    check(): { ok: true } {
        return { ok: true };
    }
}

@Controller(ApiUsers)
export class ConcatController {
    @Get()
    ping(): { pong: true } {
        return { pong: true };
    }
}
