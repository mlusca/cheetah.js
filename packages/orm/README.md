# Cheetah.js ORM
Cheetah.js ORM is a simple and powerful ORM for Cheetah.js and Bun.
<br>We don't use any query builder like knex, we have our own query builder making us faster.
**In development.**

### Menu
- [Installation](#install)
- [Entities](#entities)
- [Usage](#usage)

### [Installation](#install)
For install Cheetah.js ORM, run the command below:

```bash
bun install @cheetah.js/orm
```
Create a configuration file for the ORM in the root of the project called "cheetah.config.ts" and configure the database connection, providers and entities:

```javascript
import { PgDriver } from '@cheetah.js/orm';
import { ConnectionSettings } from '@cheetah.js/orm/driver/driver.interface';

const config: ConnectionSettings<any> = {
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: 'postgres',
  driver: PgDriver,
  migrationPath: 'path_migrations', 
  entities: 'entity/*.ts' // or [User, Post, ...]
};

export default config;
```
Actually, the ORM only supports PostgreSQL, but in the future it will support other databases.
- Entities: Path to entities. Accepts glob patterns or an array of Entity classes.
- MigrationPath: Path to migrations. Accepts glob patterns. Is optional.
<br/>
<br/>
After that, you need to import the ORM into the project and add it to the Cheetah.js instance:
    
```javascript
import { Cheetah } from '@cheetah.js/core';
import { CheetahOrm } from '@cheetah.js/orm';

new Cheetah().use(CheetahOrm).listen();
```

### [Entities](#entities)
Entities are classes that map to database tables. Each entity must have a primary key.

#### Example:
```javascript
import { Entity, PrimaryKey, Property } from '@cheetah.js/orm';

@Entity()
export class User {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}
```

#### PrimaryKey
The @PrimaryKey decorator is used to define the primary key of the entity.

#### Nullable property
For define a nullable property, add a parameter to the @Property decorator:

```javascript
@Entity()
export class User {
    @PrimaryKey()
    id: number;

    @Property({ nullable: true })
    name: string;
}
```
Cheetah ORM can also distinguish nullable properties automatically by adding the question mark to the end of the property name:

```javascript
export class User {
    @PrimaryKey()
    id: number;

    @Property()
    name?:string;
}
```

#### Unique property
For define a unique property, add a parameter to the @Property decorator:

```javascript
@Entity()
export class User {
    @PrimaryKey()
    id: number;

    @Property({ unique: true })
    name: string;
}
```

#### Index property
For define a index for a unique property, add a parameter to the @Property decorator:

```javascript
@Entity()
export class User {
    @PrimaryKey()
    id: number;

    @Property({ index: true })
    name: string;
}
```

For define a index for a multiple properties, add the @Index decorator:

```javascript
@Entity()
export class User {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @Index(['name', 'email'])
    @Property()
    email: string;
}
```

#### Property options
| Option | Type | Description                                                                                |
| ------ | ---- |--------------------------------------------------------------------------------------------|
| nullable | boolean | Defines if the property is nullable.                                                       |
| unique | boolean | Defines if the property is unique.                                                         |
| index | boolean | Defines if the property is index.                                                          |
| default | any | Defines the default value of the property.                                                 |
| length | number | Defines the length of the property.                                                        |
| onUpdate | string | Define the action to be taken for this property when updating the entity in the database   |
| onInsert | string | Defines the action to be taken for this property when inserting the entity in the database |

#### Relations
Cheetah ORM supports relations between entities. The available relations are: OneToMany, ManyToOne.

##### OneToMany
The OneToMany relation is used to define a one-to-many relationship between two entities. For example, a user can have multiple posts, but a post can only have one user.

```javascript
@Entity()
export class User {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @OneToMany(() => Post, (post) => post.user)
    posts: Post[];
}
```

#### ManyToOne
The owner side of the relation is the side that has the @ManyToOne decorator. The inverse side is the side that has the @OneToMany decorator. The owner side is always the side that has the foreign key.

```javascript
@Entity()
export class Post {
    @PrimaryKey()
    id: number;

    @Property()
    title: string;

    @ManyToOne(() => User)
    user: User;
}
```

### [Usage](#usage)
#### Create a new entity
```javascript
import { User } from './entity/user';

const user = User.create({ name: 'John Doe' });

// OR
const user = new User();
user.name = 'John Doe';
await user.save();
```

#### Find a entity
```javascript
import { User } from './entity/user';

const user = await User.findOne({ 
    name: 'John Doe',
    old: { $gte: 16, $lte: 30 }
});
```

#### List of supported operators
| Operator |Name | Description |
| ------ | ---- |--------------------------------------------------------------------------------------------|
| $eq | Equal | Matches values that are equal to a specified value. |
| $gt | Greater Than | Matches values that are greater than a specified value. |
| $gte | Greater Than or Equal | Matches values that are greater than or equal to a specified value. |
| $in | In | Matches any of the values specified in an array. |
| $lt | Less Than | Matches values that are less than a specified value. |
| $lte | Less Than or Equal | Matches values that are less than or equal to a specified value. |
| $ne | Not Equal | Matches all values that are not equal to a specified value. |
| $nin | Not In | Matches none of the values specified in an array. |
| $and | And | Joins query clauses with a logical AND returns all documents that match the conditions of both clauses. |
 | $or | Or | Joins query clauses with a logical OR returns all documents that match the conditions of either clause. |
| $not | Not | Inverts the effect of a query expression and returns documents that do not match the query expression. |

### [Migrations](#migrations)
Cheetah ORM is capable of creating and running migrations.
You must have the connection configuration file in the project root "cheetah.config.ts".
To create a migration, run the command below:

```bash
bun cheetah-orm migration:generate
```
This command will create a migration file in the path defined in the configuration file, differentiating your entities created with the database.

#### Example:
```bash
bun cheetah-orm migration:run
```
This command will run all migrations that have not yet been run.

