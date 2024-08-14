export default defineNuxtRouteMiddleware((to, from) => {
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
            // Token exists in localStorage, continue to the next middleware or the actual request handler
            return;
        } else {
            // Token not found in request or localStorage, return a 401 response
            abortNavigation("401")
        }
    }
});
