import { createError, getHeader } from 'h3';

export default defineEventHandler((event) => {
    if (!event.path.startsWith('/api')) {
        return;
    }
    const { token } = useRuntimeConfig();

    // If `basicAuth` is empty, do not prompt for authentication
    if (!token) {
        return;
    }


    const authHeader = getHeader(event, 'x-token');
    // If the given authentication header is valid, do not prompt for authentication
    if (authHeader && authHeader == token) {
        return;
    } else {
        throw createError({ statusCode: 401, statusMessage: 'Not authorized' });
    }
});
