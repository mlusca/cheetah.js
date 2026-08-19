import { Controller, Get, Param } from '@carno.js/core';

@Controller('/profile')
export class ProfileController {
    @Get()
    show(@Param('id') id: string): { userId: string; bio: string } {
        return { userId: id, bio: 'hello' };
    }
}
