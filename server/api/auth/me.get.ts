// Returns the current user session, or null when logged out.
// Used by the admin UI to decide whether to show a login button or the app.

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  if (!session?.user) {
    return { user: null };
  }
  return { user: session.user };
});
