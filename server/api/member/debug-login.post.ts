import { createError, readBody } from "h3";

// DEV-ONLY impersonation: sign in as any e-mail without proving you own it.
//
// This is a total auth bypass. It exists so you can look at any member's page
// locally without a mailbox round-trip, and it is gated twice so it cannot
// reach production:
//
//   1. `import.meta.dev` — false in any `nuxt build` output. This is a compile
//      -time constant, so the guard can't be flipped by an env var in prod.
//   2. NUXT_PUBLIC_DEBUG_AUTH=true — must be opted into explicitly even in dev,
//      so a shared dev server isn't wide open by default. Same key the
//      /connexion form reads, so one env var can't enable half the feature.
//
// Both must hold. If either fails the route 404s, so it doesn't even advertise
// that it exists.
//
// The e-mail does NOT have to be on the roster — pass an unknown one to
// exercise the "adresse non reconnue" screen.

interface DebugLoginBody {
  email?: string;
}

export default defineEventHandler(async (event) => {
  const { public: pub } = useRuntimeConfig(event);

  if (!import.meta.dev || pub.debugAuth !== true) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const email = String(((await readBody<DebugLoginBody>(event)) ?? {}).email ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: "email required" });
  }

  console.warn(`[debug-auth] impersonating ${email} — dev only`);

  await setUserSession(event, {
    user: { email, name: email },
    loggedInAt: Date.now(),
  });

  return { ok: true as const, email };
});
