import { createError, getHeader } from 'h3';

// Admin paths handle their own auth via requireAdmin (Google OAuth + Comité
// allowlist). The X-Token below is the legacy shared cashier secret.
// /api/_auth/ is nuxt-auth-utils's own session endpoint (used by useUserSession).
const ADMIN_PATH_PREFIXES = ['/api/debts', '/api/payments', '/api/auth/', '/api/_auth/', '/api/send-summary'];

export default defineEventHandler((event) => {
    if (!event.path.startsWith('/api')) {
        return;
    }
    if (ADMIN_PATH_PREFIXES.some((p) => event.path.startsWith(p))) {
        return;
    }
    const { token } = useRuntimeConfig();

    // If `token` is empty, do not prompt for authentication
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
