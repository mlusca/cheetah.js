import { generate } from '../codegen/generate';

const include = process.env.CARNO_CLIENT_INCLUDE
    ? process.env.CARNO_CLIENT_INCLUDE.split(',').map((part) => part.trim()).filter(Boolean)
    : undefined;

try {
    generate({
        root: process.env.CARNO_CLIENT_ROOT || process.cwd(),
        output: process.env.CARNO_CLIENT_OUTPUT,
        include,
        watch: false,
        silent: process.env.CARNO_CLIENT_SILENT === '1'
    });
} catch (error) {
    console.error('[@carno.js/client] preload generate failed:', error);
}
