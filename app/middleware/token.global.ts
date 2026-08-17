// Routes that authenticate some other way than the shared X-Token (the cashier
// tablet secret): the treasurer dashboard and the member area both use a
// session cookie (Google OAuth or magic link). Listed by prefix so future
// sub-pages are exempt without edits.
const NON_TOKEN_ROUTE_PREFIXES = ['/dettes', '/auth/', '/mon-compte', '/connexion'];

export default defineNuxtRouteMiddleware((to, from) => {
    // Skip during SSR / static prerender. Without this, building the index
    // page would call abortNavigation (no cookie at build time) and the
    // generated output would be missing index.html — host serves 404 at /.
    if (import.meta.server) return;

    if (NON_TOKEN_ROUTE_PREFIXES.some((p) => to.path.startsWith(p))) {
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
