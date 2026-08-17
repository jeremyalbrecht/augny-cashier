// Google OAuth callback. The redirect URI registered in Google Cloud Console
// must point to: <origin>/auth/google
//
// nuxt-auth-utils picks up credentials from NUXT_OAUTH_GOOGLE_CLIENT_ID and
// NUXT_OAUTH_GOOGLE_CLIENT_SECRET. Session is encrypted with NUXT_SESSION_PASSWORD.

import { getRequestHost } from "h3";

/** The member area is served from compte.<domain>; the treasurer dashboard from
 *  the main host. Both share this one callback, so pick the landing page from
 *  the host the browser actually came in on. */
function isMemberHost(event: Parameters<typeof getRequestHost>[0]): boolean {
  return getRequestHost(event).toLowerCase().startsWith("compte.");
}

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
