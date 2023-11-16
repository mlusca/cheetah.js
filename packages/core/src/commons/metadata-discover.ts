import {globby} from 'globby'
import "reflect-metadata";

export class MetadataDiscover {

    private static instance: MetadataDiscover

    static getInstance(): MetadataDiscover {
        if (typeof this.instance === 'undefined') {
            this.instance = new MetadataDiscover()
            return this.instance
        }

        return this.instance
    }

    async discover() {
        const startTime = Date.now()
        const paths = await globby(['**/*.ts', '!node_modules'], {expandDirectories: true, gitignore: true, absolute: true});

        for (const path of paths) {
            await import(path);
        }

        const endTime = Date.now();

        const duration = endTime - startTime;
        console.log(`Time taken: ${duration} milliseconds`);
    }
}