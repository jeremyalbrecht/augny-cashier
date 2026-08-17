import { createError, getHeader } from 'h3';

// Paths that handle their own auth and must be carved out of the shared
// X-Token gate below (which is the legacy cashier-tablet secret):
//   - /api/debts, /api/payments, /api/send-summary, /api/relances
//       → requireAdmin (Google OAuth + Comité allowlist)
//   - /api/member/
//       → requireMember (Google OAuth or magic link + Joueurs roster), except
//         the magic-link request/verify routes which are unauthenticated by
//         necessity — they are how you get a session in the first place.
//   - /api/auth/, /api/_auth/
//       → nuxt-auth-utils's own session endpoints (used by useUserSession).
const SELF_AUTH_PATH_PREFIXES = [
    '/api/debts',
    '/api/payments',
    '/api/send-summary',
    '/api/relances',
    '/api/member',
    '/api/auth/',
    '/api/_auth/',
];

export default defineEventHandler((event) => {
    if (!event.path.startsWith('/api')) {
        return;
    }
    if (SELF_AUTH_PATH_PREFIXES.some((p) => event.path.startsWith(p))) {
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
