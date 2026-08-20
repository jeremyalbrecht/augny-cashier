// Google OAuth callback. The redirect URI registered in Google Cloud Console
// must point to: <origin>/auth/google
//
// nuxt-auth-utils picks up credentials from NUXT_OAUTH_GOOGLE_CLIENT_ID and
// NUXT_OAUTH_GOOGLE_CLIENT_SECRET. Session is encrypted with NUXT_SESSION_PASSWORD.

import { isMemberHost } from "#server/utils/host";

// Both the member area and the treasurer dashboard share this one OAuth
// callback, so the landing page is picked from the host the browser actually
// came in on — see isMemberHost.

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ["email", "profile"],
  },
  async onSuccess(event, { user }) {
    // Sign-in is deliberately NOT gated on roster or Comité membership. Any
    // Google account gets a session; /api/member/me and requireAdmin decide
    // independently what that session can actually see.
    await setUserSession(event, {
      user: {
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      loggedInAt: Date.now(),
    });
    return sendRedirect(event, isMemberHost(event) ? "/mon-compte" : "/dettes");
  },
  onError(event, error) {
    console.error("Google OAuth error:", error);
    return sendRedirect(event, isMemberHost(event) ? "/connexion?error=oauth" : "/?error=oauth");
  },
});
