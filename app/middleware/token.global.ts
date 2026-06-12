// Routes that use Google OAuth instead of the shared X-Token (cashier secret).
// Listed by prefix so future admin sub-pages are also exempt without edits.
const OAUTH_ROUTE_PREFIXES = ['/dettes', '/auth/'];

export default defineNuxtRouteMiddleware((to, from) => {
    // Skip during SSR / static prerender. Without this, building the index
    // page would call abortNavigation (no cookie at build time) and the
    // generated output would be missing index.html — host serves 404 at /.
    if (import.meta.server) return;

    if (OAUTH_ROUTE_PREFIXES.some((p) => to.path.startsWith(p))) {
        return;
    }
    const token = useCookie('token', {maxAge: 60 * 60 * 24 * 365});


    // Extract token from the query parameters (or body if it's a POST request)
    const fetchedToken = from.query.token;
    if (fetchedToken) {
        // Save the token to the localStorage
        console.log(`User has provided token: ${fetchedToken}`)
        token.value = fetchedToken
        // Continue to the next middleware or the actual request handler
        return;
    } else {
        // Try to retrieve the token from localStorage
        const storedToken = token.value
        if (storedToken) {
            console.log(`Token not given but present in localStorage: ${storedToken}`)
            return;
        } else {
            // Token not found in request or localStorage, return a 401 response
            return abortNavigation("401")
        }
    }
});
