import { describe, expect, test } from 'bun:test';
import { DependencyGraph } from '../src/graph/DependencyGraph';

describe('DependencyGraph', () => {
    test('resolves an instance that depends on the exact key', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users#42', columns: null })).toEqual(['i1']);
    });

    test('a row write wakes the table subscriber through the ancestor', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('list', [{ key: 'orm:users', columns: null }]);
        graph.setDependencies('detail', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users#42', columns: null }).sort()).toEqual(['detail', 'list']);
    });

    test('a table write wakes row subscribers because it may touch any row', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('detail', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users', columns: null })).toEqual(['detail']);
    });

    test('does not wake a row subscriber for a different row', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('detail', [{ key: 'orm:users#42', columns: null }]);

        expect(graph.resolve({ key: 'orm:users#7', columns: null })).toEqual([]);
    });

    test('skips an instance whose read columns do not intersect the write', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [{ key: 'orm:users', columns: ['id', 'name'] }]);

        expect(graph.resolve({ key: 'orm:users', columns: ['last_seen_at'] })).toEqual([]);
        expect(graph.resolve({ key: 'orm:users', columns: ['name'] })).toEqual(['i1']);
    });

    test('a wildcard on either side always intersects', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('narrow', [{ key: 'orm:users', columns: ['id'] }]);
        graph.setDependencies('wide', [{ key: 'orm:users', columns: null }]);

        expect(graph.resolve({ key: 'orm:users', columns: null }).sort()).toEqual(['narrow', 'wide']);
        expect(graph.resolve({ key: 'orm:users', columns: ['zzz'] })).toEqual(['wide']);
    });

    test('returns each instance once even when several keys match', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [
            { key: 'orm:users', columns: null },
            { key: 'orm:users#42', columns: null }
        ]);

        expect(graph.resolve({ key: 'orm:users#42', columns: null })).toEqual(['i1']);
    });

    test('replacing dependencies drops the previous ones', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [{ key: 'orm:users', columns: null }]);
        graph.setDependencies('i1', [{ key: 'orm:orders', columns: null }]);

        expect(graph.resolve({ key: 'orm:users', columns: null })).toEqual([]);
        expect(graph.resolve({ key: 'orm:orders', columns: null })).toEqual(['i1']);
        expect(graph.keyCount()).toBe(1);
    });

    test('remove clears every key the instance held', () => {
        const graph = new DependencyGraph();
        graph.setDependencies('i1', [
            { key: 'orm:users', columns: null },
            { key: 'orm:orders', columns: null }
        ]);
        graph.remove('i1');

        expect(graph.keyCount()).toBe(0);
        expect(graph.instanceCount()).toBe(0);
        expect(graph.resolve({ key: 'orm:users', columns: null })).toEqual([]);
    });
});
