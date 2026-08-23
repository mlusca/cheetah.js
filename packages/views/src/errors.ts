import { ForbiddenException, NotFoundException } from '@carno.js/core';

/**
 * Thrown when a template cannot be resolved under the views root.
 * The public message never includes absolute filesystem paths.
 */
export class ViewNotFoundError extends NotFoundException {
    readonly view: string;
    readonly tried: string[];

    constructor(view: string, tried: string[]) {
        super(`View "${view}" was not found`);
        this.name = 'ViewNotFoundError';
        this.view = view;
        this.tried = tried;
    }
}

/**
 * Thrown when a view name would escape the configured views root.
 */
export class ViewForbiddenError extends ForbiddenException {
    constructor(message = 'View path is not allowed') {
        super(message);
        this.name = 'ViewForbiddenError';
    }
}
