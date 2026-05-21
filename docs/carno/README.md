# Carno.js Documentation Site

This directory contains the Docusaurus site published at:

[https://carnojs.github.io/carno.js](https://carnojs.github.io/carno.js)

Use this site for user-facing documentation: guides, examples, API explanations, package-specific documentation, and benchmark details. The repository root README should stay concise and point readers here for implementation guidance.

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run start
```

Build the production site:

```bash
npm run build
```

Serve a local production build:

```bash
npm run serve
```

## Structure

- `docs/`: documentation pages grouped by product area.
- `sidebars.ts`: sidebar organization for the documentation.
- `src/pages/`: custom site pages.
- `src/css/custom.css`: global theme overrides.
- `static/`: static assets served by Docusaurus.

## Writing Guidelines

- Keep package usage examples in the relevant documentation page, not in the root README.
- Prefer concise explanations followed by complete examples that users can run.
- Link related pages instead of duplicating large sections.
- Keep benchmark claims tied to the methodology page.
- Run `npm run build` before publishing documentation changes.
