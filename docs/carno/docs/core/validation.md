---
sidebar_position: 3
---

# Validation

Validation protects controller handlers from receiving malformed request bodies. In Carno, validation is integrated into the request pipeline: when a `@Body()` parameter is typed as a DTO class with `@Schema()`, the body is parsed, validated and only then passed to the handler.

The goal is to keep handlers focused on application behavior:

```ts
@Post()
create(@Body() body: CreateUserDto) {
  return this.users.create(body);
}
```

The handler can assume `body` already passed the schema attached to `CreateUserDto`.

## How Validation Is Triggered

Validation runs when all of these are true:

1. A route handler has a `@Body()` parameter.
2. The parameter type is a class.
3. That class is decorated with `@Schema(schema)`.
4. Validation is enabled on the app.

```ts
import { Body, Controller, Post, Schema } from '@carno.js/core';
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

@Schema(CreateUserSchema)
class CreateUserDto {
  email!: string;
  password!: string;
}

@Controller('/users')
class UserController {
  @Post()
  create(@Body() body: CreateUserDto) {
    return { created: true, user: body };
  }
}
```

If validation fails, Carno returns `400 Bad Request` with a structured error payload.

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "path": "email",
      "message": "Invalid email address"
    }
  ]
}
```

## Default Adapter: Zod

Zod validation is enabled by default when `validation` is omitted or set to `true`.

```ts
import { Carno } from '@carno.js/core';

const app = new Carno({
  validation: true,
});
```

This is equivalent to using the built-in `ZodAdapter`.

```ts
import { Carno, ZodAdapter } from '@carno.js/core';

const app = new Carno({
  validation: ZodAdapter,
});
```

You can also pass an adapter instance:

```ts
const app = new Carno({
  validation: new ZodAdapter(),
});
```

## Validated Data Is the Parsed Output

Adapters return the parsed output from the validation library. With Zod, that means transforms, defaults and coercions defined in the schema are applied by `safeParse()`.

```ts
const SearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

@Schema(SearchSchema)
class SearchDto {
  page!: number;
}
```

The controller receives the validated output, not the original raw body.

## Body Parsing

Validation uses the same body parsing path as `@Body()`.

Supported content types:

| Content type | Parsed as |
| :--- | :--- |
| `application/json` | JSON object |
| `application/x-www-form-urlencoded` | Object created from form data |
| `multipart/form-data` | Object created from form data |
| `text/*` | String |
| Other | `ArrayBuffer` |

Most validation schemas are designed for JSON objects, so API endpoints commonly use `Content-Type: application/json`.

## Field-Level `@Body('key')`

`@Body('key')` extracts one property from the parsed body.

```ts
@Post('/login')
login(
  @Body('email') email: string,
  @Body('password') password: string,
) {
  return this.auth.login(email, password);
}
```

Schema validation is tied to DTO class parameters. For complete request validation, prefer `@Body() dto: SomeDto`.

## Valibot Support

Carno includes a built-in `ValibotAdapter`.

Install Valibot in your project:

```bash
bun add valibot
```

Configure the app:

```ts
import { Carno, ValibotAdapter } from '@carno.js/core';

const app = new Carno({
  validation: ValibotAdapter,
});
```

Define a DTO with a Valibot schema:

```ts
import * as v from 'valibot';
import { Schema } from '@carno.js/core';

const CreatePostSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1)),
  body: v.string(),
});

@Schema(CreatePostSchema)
class CreatePostDto {
  title!: string;
  body!: string;
}
```

## Disabling Validation

Disable framework validation by setting `validation: false`.

```ts
const app = new Carno({
  validation: false,
});
```

When disabled, `@Body()` still parses the request body, but no schema validation is executed by the framework.

## Custom Validator Adapter

You can support another validation library by implementing `ValidatorAdapter`.

```ts
import type {
  ValidationResult,
  ValidatorAdapter,
} from '@carno.js/core';
import { ValidationException, getSchema } from '@carno.js/core';

class MyValidatorAdapter implements ValidatorAdapter {
  readonly name = 'MyValidatorAdapter';

  hasValidation(target: any): boolean {
    return getSchema(target) !== undefined;
  }

  validate<T>(target: any, value: unknown): ValidationResult<T> {
    const schema = getSchema(target);

    if (!schema) {
      return { success: true, data: value as T };
    }

    // Run your validation library here.
    return { success: true, data: value as T };
  }

  validateOrThrow<T>(target: any, value: unknown): T {
    const result = this.validate<T>(target, value);

    if (result.success) {
      return result.data!;
    }

    throw new ValidationException(result.errors ?? []);
  }
}
```

Then register it:

```ts
const app = new Carno({
  validation: new MyValidatorAdapter(),
});
```

## Practical Guidelines

- Validate full DTOs with `@Body() dto: DtoClass` for create and update endpoints.
- Keep schemas close to the DTO classes they describe.
- Use schema defaults and coercions deliberately; they change what the controller receives.
- Treat validation as input validation, not authorization or business rule enforcement.
- Return domain-specific errors from services when a valid request still violates business rules.
- Disable validation only for internal endpoints or when you are handling validation manually.

## See Also

- [Controllers & Routing](./controllers) for `@Body()` and route handlers.
- [Context](./context) for manual body parsing.
- [Middleware](./middleware) for request pipeline behavior.
