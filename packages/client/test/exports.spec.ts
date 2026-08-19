import { describe, expect, test } from 'bun:test';
import { Client, ClientService, client } from '../src/index';
import { generate } from '../src/codegen';
import { carnoClient } from '../src/vite/plugin';

describe('package exports', () => {
    test('main entry exposes client and the Client plugin factory', () => {
        expect(typeof client).toBe('function');
        expect(typeof Client).toBe('function');
        expect(typeof ClientService).toBe('function');

        const plugin = Client({ watch: false, silent: true, nodeEnv: 'production' });
        expect(plugin.constructor.name).toBe('Carno');
    });

    test('codegen and vite entries expose the shipped generate path', () => {
        expect(typeof generate).toBe('function');
        expect(typeof carnoClient).toBe('function');
        expect(carnoClient().name).toBe('carno-client');
    });
});
