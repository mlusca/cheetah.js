export type App = {
    users: {
        get: { query: { page?: string }; response: { id: string }[] };
        post: { body: { name: string; email: string }; response: { id: string } };
        ':id': {
            get: { params: { id: string }; response: { id: string; name: string; email: string } };
            delete: { params: { id: string }; response: undefined };
            posts: {
                post: { body: { title: string }; response: { id: string; title: string } };
            };
        };
    };
};
