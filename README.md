# Cheetah.js
Cheetah.js is a simple object-oriented framework for Bun still in development.
<br>
Check the ORM documentation [here](https://github.com/mlusca/cheetah.js/tree/master/packages/orm).
### Menu
- [Installation](#install)

### [Installation](#install)
For install Cheetah.js, run the command below:

```bash 
bun install @cheetah.js/core
```

Your tsconfig.json should have the following settings:
```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Start the server
```javascript
import { Cheetah } from '@cheetah.js/core';

new Cheetah().listen();
```

### Controller and Routes
In Cheetah.js, all classes in dependency injection are considered providers, including controllers.
#### Example:
```javascript 
import { Controller, Get, Cheetah } from '@cheetah.js/core';

@Controller()
export class HomeController {
  @Get('/')
  index() {
    return 'Hello World!';
  }
}

new Cheetah({ 
    providers: [ HomeController ]
}).listen();
```
To receive parameters in the route, simply add the ":" before the parameter name. And to receive it in the method, just use the @Param decorator.
```javascript
import { Controller, Get } from '@cheetah.js/core';

@Controller()
export class HomeController {
  @Get(':name')
  index(@Param('name') name: string) {
    return `Hello ${name}!`;
  }
}
```

### Validation
Cheetah.js validates route parameters using [class-validator](https:github.comtypestackclass-validator). Simply add the DTO as a method parameter and Cheetah.js will validate the route parameters.
#### Exemplo:
```javascript
import { Controller, Get, Query } from '@cheetah.js/core';

export class UserDto {
  @IsString()
  name: string;
}

@Controller()
export class HomeController {
  @Get()
  index(@Query() user: UserDto) {
    return `Hello ${user.name}!`;
  }
}
```
To configure the validator, simply pass the options in the Cheetah.js constructor:
```javascript
import { Cheetah } from '@cheetah.js/core';

new Cheetah({ 
    validator: {
        whitelist: true
    }
}).listen();
```

### List of decorators
| Decorator | Description                                 |
| --- |---------------------------------------------|
| @Controller() | Defines the class as a controller           |
| @Get() | Defines the route as GET                    |
| @Post() | Defines the route as POST                   |
| @Put() | Defines the route as PUT                    |
| @Patch() | Defines the route as PATCH                  |
| @Delete() | Defines the route as DELETE                 |
| @Middleware() | Defines the middleware to a class or method |
| @Param() | Get the param from url                      |
| @Query() | Get the query from url                      |
| @Body() | Get the body from request                   |
| @Header() | Get the header from request                 |
| @Context() | Get the context from request               |


### Dependency injection
Cheetah.js provides support for dependency injection using the @Service decorator.
The available scopes are Singleton (default), request and instance. You can define services to handle business logic and inject them into controllers or other services as needed. </br>
#### Example:
```javascript
import { Service } from '@cheetah.js/core';

@Service() // Default scope is Singleton
export class UserService {
    create() {
        return 'User created!';
    }
}


@Service()
export class AnotherService {
    constructor(userService: UserService) {
        console.log(userService.create()); // User created!
    }
}
```
### Middleware
Cheetah.js supports the use of middleware to process requests before they reach their defined routes. This allows you to perform additional logic and manipulate context.
Middlewares can be added to the class or method and all middleware must be in the scope of dependency injection.
#### Example:
```javascript
import { Context, Middleware, Service, CheetahMiddleware, CheetahClosure } from '@cheetah.js/core';

@Service
export class LoggerMiddleware implements CheetahMiddleware {
    handle(context: Context, next: CheetahClosure) {
        next();
    }
}

@Middleware(LoggerMiddleware)
@Controller()
export class HomeController {
    @Get('/')
    index() {
        return 'Hello World!';
    }
}
```

### Logging
We provide the LoggerService service, it uses pinojs to log.
```javascript
import { Cheetah, LoggerService, Controller } from '@cheetah.js/core';

@Controller()
export class HomeController {
    constructor(logger: LoggerService) {
        this.logger.info("Hello World!")
    }
}

new Cheetah({logger: {level: 'info'}}).listen();
```
If you need to customize the logger, it can be configured:
```javascript
import { Cheetah } from '@cheetah.js/core';

new Cheetah().useLogger(CustomServiceLogger)
```

### Contributing
Contributions are welcome! Feel free to open issues and submit pull requests.