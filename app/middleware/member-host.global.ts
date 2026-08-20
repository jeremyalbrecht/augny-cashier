// Sends the member subdomain's root ("https://compte.<domain>/") to
// /mon-compte instead of the cashier page.
//
// Filename matters: Nuxt runs global middleware in alphabetical order, and
// this must run before token.global.ts — that middleware 401s on "/" (not in
// its own exempt-prefix list) unless a request is already redirected to
// /mon-compte by the time it runs. "member-host" < "token" keeps that order;
// don't rename either file without checking this still holds.
//
// This MUST be a client-side redirect, not a server/edge path rewrite. The
// app is ssr:false, so the HTML this server ever sends is an empty shell
// (`window.__NUXT__ = {}`, no rendered content, no route info) — Vue Router's
// initial route comes entirely from the browser's own `window.location`,
// which neither a Cloudflare Transform Rule nor a Nitro server middleware can
// change (they rewrite what the origin receives, not what the browser's
// address bar or `window.location` report). Only code that actually runs in
// the browser can pick a different route here.
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return;
  if (to.path !== "/") return;
  if (window.location.hostname.toLowerCase().startsWith("compte.")) {
    return navigateTo("/mon-compte", { replace: true });
  }
});
