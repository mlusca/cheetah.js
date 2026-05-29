---
sidebar_position: 2
---

# Controllers & Routing

Controllers group HTTP endpoints into classes. Each controller has an optional base path, route methods and dependencies resolved by the DI container.

Use controllers for request/response orchestration:

- Read parameters, query strings, headers and body.
- Call services that contain business logic.
- Return a response shape.
- Apply route-level middleware.

Keep controllers thin. They should coordinate the request, not own most domain behavior.

## Defining a Controller

Use `@Controller()` with a base path.

```ts
import { Controller, Get } from '@carno.js/core';

@Controller('/users')
export class UserController {
  @Get()
  findAll() {
    return [{ id: 1, name: 'Alice' }];
  }
}
```

Register controllers on the app or plugin.

```ts
import { Carno } from '@carno.js/core';

const app = new Carno()
  .controllers([UserController]);

app.listen(3000);
```

## HTTP Method Decorators

Carno provides route decorators for standard HTTP methods.

| Decorator | Method |
| :--- | :--- |
| `@Get(path?)` | `GET` |
| `@Post(path?)` | `POST` |
| `@Put(path?)` | `PUT` |
| `@Patch(path?)` | `PATCH` |
| `@Delete(path?)` | `DELETE` |
| `@Head(path?)` | `HEAD` |
| `@Options(path?)` | `OPTIONS` |

The path argument is optional. If omitted, the route uses the controller base path.

```ts
@Controller('/posts')
export class PostController {
  @Get()
  list() {
    return [];
  }

  @Get('/:id')
  findOne(@Param('id') id: string) {
    return { id };
  }

  @Post()
  create(@Body() body: CreatePostDto) {
    return body;
  }
}
```

## Path Rules

Controller paths and method paths can be written with or without a leading slash.

```ts
@Controller('users')
class UsersController {
  @Get(':id')
  findOne() {}
}
```

Carno normalizes them to `/users/:id`.

Trailing slashes are normalized on controller paths, and the final route path is built from parent controller path, controller path and method path.

## Route Parameters

Use `:name` segments in route paths and read them with `@Param()`.

```ts
@Get('/:id/books/:bookId')
findBook(
  @Param('id') userId: string,
  @Param('bookId') bookId: string,
) {
  return { userId, bookId };
}
```

Use `@Param()` without a key to receive the full params object.

```ts
@Get('/:id')
findOne(@Param() params: Record<string, string>) {
  return params;
}
```

## Request Data Decorators

| Decorator | Description |
| :--- | :--- |
| `@Body(key?)` | Parsed request body or one body field |
| `@Query(key?)` | Parsed query string or one query field |
| `@Param(key?)` | Route params or one param |
| `@Header(key?)` | Request headers or one header |
| `@Req()` | Native `Request` object |
| `@Ctx()` | Carno `Context` |
| `@Locals(key?)` | Values stored in `ctx.locals` |

```ts
import {
  Body,
  Controller,
  Header,
  Param,
  Patch,
  Query,
} from '@carno.js/core';

@Controller('/users')
class UserController {
  @Patch('/:id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Query('verbose') verbose?: string,
    @Header('user-agent') userAgent?: string,
  ) {
    return { id, body, verbose, userAgent };
  }
}
```

## Dependency Injection in Controllers

Controllers are resolved by the DI container. Inject services through the constructor.

```ts
@Controller('/users')
export class UserController {
  constructor(private users: UserService) {}

  @Get('/:id')
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }
}
```

This keeps the controller focused on HTTP concerns while the service owns application behavior.

## Nested Controllers

Use nested controllers to build route trees.

```ts
@Controller({
  path: '/api',
  children: [UsersController, PostsController],
})
export class ApiController {}

@Controller('/users')
export class UsersController {
  @Get()
  list() {
    return [];
  }
}
```

The final path for `UsersController.list()` is `/api/users`.

Middleware applied to a parent controller is inherited by child controllers.

## Responses

Carno accepts several handler return types.

### Objects and Arrays

Objects and arrays are serialized as JSON.

```ts
@Get()
findAll() {
  return { data: [] };
}
```

### Strings

Strings are returned as `text/plain`.

```ts
@Get('/health')
health() {
  return 'OK';
}
```

### `undefined` or `void`

Returning `undefined` sends `204 No Content`.

```ts
@Delete('/:id')
remove(@Param('id') id: string) {
  this.users.remove(id);
}
```

### Native `Response`

Return a Web `Response` object for full control.

```ts
@Get('/download')
download() {
  return new Response('file contents', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
```

### Context Helpers

Use `Context` helpers when you need a custom status or content type.

```ts
import { Context, Ctx, Post } from '@carno.js/core';

@Post()
create(@Ctx() ctx: Context, @Body() body: any) {
  return ctx.json({ id: 1, ...body }, 201);
}
```

Available helpers:

| Helper | Description |
| :--- | :--- |
| `ctx.json(data, status?)` | JSON response |
| `ctx.text(data, status?)` | Plain text response |
| `ctx.html(data, status?)` | HTML response |
| `ctx.redirect(url, status?)` | Redirect response |

## Validation

When a `@Body()` parameter is typed as a DTO class decorated with `@Schema()`, Carno validates the body before the handler runs.

```ts
@Post()
create(@Body() body: CreateUserDto) {
  return this.users.create(body);
}
```

See [Validation](./validation) for schema setup and adapter configuration.

## Practical Guidelines

- Keep business logic in services, not controllers.
- Use DTOs for request bodies that need validation.
- Return native `Response` only when helpers or default serialization are not enough.
- Use nested controllers for shared path prefixes.
- Apply middleware at the narrowest useful level: route, controller or global.

## See Also

- [Context](./context) for request data and response helpers.
- [Validation](./validation) for DTO validation.
- [Dependency Injection](./dependency-injection) for service injection.
- [Middleware](./middleware) for route and controller middleware.
