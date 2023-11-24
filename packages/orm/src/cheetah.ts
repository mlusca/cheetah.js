import {Migrator} from "./migration/migrator";
import { Command } from 'commander';

const program = new Command();

program
    .name('cheetah-cli')
    .description('CLI to Cheetah.js ORM ')

program.command('migration:generate')
    .description('generate a new migration file with a diff')
    .action(async (str, options) => {
        const migrator = new Migrator()
        await migrator.initConfigFile()
        await migrator.createMigration()
        process.exit(0)
    });

program.command('migration:run')
    .description('run all pending migrations')
    .action(async (str, options) => {
      const migrator = new Migrator()
      await migrator.initConfigFile()
      await migrator.migrate()
      process.exit(0)
    });

program.parse();