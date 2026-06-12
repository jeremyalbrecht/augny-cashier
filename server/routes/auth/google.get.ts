// Google OAuth callback. The redirect URI registered in Google Cloud Console
// must point to: <origin>/auth/google
//
// nuxt-auth-utils picks up credentials from NUXT_OAUTH_GOOGLE_CLIENT_ID and
// NUXT_OAUTH_GOOGLE_CLIENT_SECRET. Session is encrypted with NUXT_SESSION_PASSWORD.

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ["email", "profile"],
  },
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      loggedInAt: Date.now(),
    });
    return sendRedirect(event, "/dettes");
  },
  onError(event, error) {
    console.error("Google OAuth error:", error);
    return sendRedirect(event, "/?error=oauth");
  },
});
