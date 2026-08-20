// Google OAuth callback. The redirect URI registered in Google Cloud Console
// must point to: <origin>/auth/google
//
// nuxt-auth-utils picks up credentials from NUXT_OAUTH_GOOGLE_CLIENT_ID and
// NUXT_OAUTH_GOOGLE_CLIENT_SECRET. Session is encrypted with NUXT_SESSION_PASSWORD.

import { getQuery } from "h3";
import { isMemberHost } from "#server/utils/host";

// Both the member area and the treasurer dashboard share this one OAuth
// callback. The landing page is picked from the `state` query param, which
// nuxt-auth-utils forwards to Google and back unmodified (see
// node_modules/nuxt-auth-utils/dist/runtime/server/lib/oauth/google.js) —
// connexion.vue's and dettes.vue's "Se connecter avec Google" links set it to
// "member"/"admin" respectively. That's what actually determines where the
// user started, unlike the Host header: both pages are reachable from the
// same host (e.g. someone bookmarks the main domain's /mon-compte directly),
// so isMemberHost() only serves as a fallback for stale links with no state.
type Origin = "member" | "admin";

function originOf(event: Parameters<typeof getQuery>[0]): Origin {
  const state = getQuery(event).state;
  if (state === "member" || state === "admin") return state;
  return isMemberHost(event) ? "member" : "admin";
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
    return sendRedirect(event, originOf(event) === "member" ? "/mon-compte" : "/dettes");
  },
  onError(event, error) {
    console.error("Google OAuth error:", error);
    return sendRedirect(event, originOf(event) === "member" ? "/connexion?error=oauth" : "/?error=oauth");
  },
});
