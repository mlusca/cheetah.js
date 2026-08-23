# Change Log

All notable changes to this package will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 1.6.3

### Features

* **views:** add optional MVC view adapter with Handlebars, EJS, Pug, and custom engines

### Security

* **views:** confine EJS `include()` to the views root (relative, absolute, and symlink escapes)
* **views:** confine Pug `include` / `extends` to the views root (relative, absolute, and symlink escapes)
