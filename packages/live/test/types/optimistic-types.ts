import { useLive, useLiveAction } from '../../src/client/react';
import type { LiveDescriptor } from '../../src/shared/descriptor';

interface Card {
    id: string;
    title: string;
}

interface CreateCardDto {
    title: string;
}

declare const list: LiveDescriptor<{ query: { status?: string }; response: Card[] }>;
declare const create: (dto: CreateCardDto) => Promise<Card>;

export function typeChecks(): void {
    const state = useLive(list, { query: { status: 'open' } });

    // `data` is Card[] | undefined, so this compiles and `title` is a string.
    const first: string | undefined = state.data?.[0]?.title;
    void first;

    const send = useLiveAction(create, {
        optimistic: [{
            on: list,
            apply: (draft, dto) => {
                // `draft` is Card[] and `dto` is CreateCardDto, both inferred.
                draft.push({ id: 'temp', title: dto.title });
            }
        }]
    });

    void send({ title: 'inferred' });
}
