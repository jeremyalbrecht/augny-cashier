// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2024-04-03',
    devtools: {enabled: true},
    modules: ['nuxt-auth-utils'],
    experimental: {
        watcher: "chokidar",
        viteEnvironmentApi: true,
    },
    ssr: false,
    app: {
      head: {
          title: 'Augny Badminton - Espace adhérent',
        charset: 'utf-8',
        viewport: 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=0, viewport-fit=cover, interactive-widget=resizes-content',
        link: [
          // Needed for the iOS "Ajouter à l'écran d'accueil" flow, which is the
          // only way Safari will grant push permission (iOS 16.4+).
          { rel: 'manifest', href: '/manifest.webmanifest' },
          { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
        ],
        meta: [
          { name: 'theme-color', content: '#0a1f44' },
          { name: 'apple-mobile-web-app-capable', content: 'yes' },
          { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
          { name: 'apple-mobile-web-app-title', content: 'Augny Badminton' },
        ],
      }
    },
    css: ['~/assets/css/main.css'],
    runtimeConfig: {
        token: '',
        sa: '',
        // maxAge keeps members signed in for ~2 months so they aren't
        // re-authenticating every visit. Applies to treasurer sessions too.
        session: { password: '', maxAge: 60 * 60 * 24 * 60 },
        oauth: { google: { clientId: '', clientSecret: '' } },
        // SMTP (Gmail app password). Env vars: NUXT_SMTP_USER, NUXT_SMTP_PASSWORD.
        smtp: { user: '', password: '' },
        // Web push. Generate with: npx web-push generate-vapid-keys
        vapid: { publicKey: '', privateKey: '', subject: '' },
        public: {
            // The public VAPID key is needed by the browser to subscribe.
            vapidPublicKey: '',
            // DEV ONLY — set NUXT_PUBLIC_DEBUG_AUTH=true to enable the
            // impersonation form on /connexion and its /api/member/debug-login
            // endpoint, which signs you in as any e-mail with no verification.
            //
            // Deliberately in `public` and NOT mirrored by a server-only key:
            // the browser needs it to render the form and the server needs it
            // to accept the request, and two keys means one env var silently
            // enabling half the feature. Being public costs nothing — both
            // sides also require import.meta.dev, which is compiled to false
            // in any production build.
            debugAuth: false,
        },
    },
    postcss: {
        plugins: {
            tailwindcss: {},
            autoprefixer: {},
        },
    },
})
