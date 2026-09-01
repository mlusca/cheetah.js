export interface Card {
    id: string;
    title: string;
    done: boolean;
}

export interface CardFilter {
    q: string;
    limit?: number;
}
