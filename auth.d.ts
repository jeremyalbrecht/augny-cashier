// Augments the empty `User` interface that nuxt-auth-utils ships with so the
// session payload we set in server/routes/auth/google.get.ts is typed end-to-end.

declare module "#auth-utils" {
  interface User {
    email: string;
    name?: string;
    picture?: string;
  }
  interface UserSession {
    loggedInAt?: number;
  }
}

export {};
