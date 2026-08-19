import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@carno.js/core';
import { CreateUserDto, UpdateUserDto, type User } from './dto';
import { ProfileController } from './profile.controller';
import { UserPostsController } from './posts.controller';
import { UserRoutes } from './routes';

@Controller({ path: UserRoutes.base, children: [ProfileController, UserPostsController] })
export class UserController {
    @Get()
    list(@Query('page') page?: string): User[] {
        return [];
    }

    @Get(UserRoutes.search)
    search(@Query() query: { q: string; limit?: number }): User[] {
        return [];
    }

    @Get(UserRoutes.byId)
    findOne(@Param('id') id: string): Promise<User> {
        return Promise.resolve({ id, name: 'Ada', email: 'ada@x.com' });
    }

    @Post()
    create(@Body() dto: CreateUserDto): User {
        return { id: '1', name: dto.name, email: dto.email };
    }

    @Put(UserRoutes.byId)
    update(@Param('id') id: string, @Body() dto: UpdateUserDto): User {
        return { id, name: dto.name ?? 'Ada', email: dto.email ?? 'ada@x.com' };
    }

    @Delete(UserRoutes.byId)
    remove(@Param('id') id: string): void {
        void id;
    }
}
