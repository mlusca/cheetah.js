import { Body, Controller, Get, Param, Post } from '@carno.js/core';

export interface PostItem {
    id: string;
    userId: string;
    title: string;
}

@Controller('/:id/posts')
export class UserPostsController {
    @Get()
    list(@Param('id') id: string): PostItem[] {
        return [{ id: 'p1', userId: id, title: 'Hello' }];
    }

    @Post()
    create(
        @Param('id') id: string,
        @Body() body: { title: string }
    ): PostItem {
        return { id: 'p2', userId: id, title: body.title };
    }
}
