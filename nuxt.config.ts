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
          title: 'Augny Badminton Cashier - Enregistrement des dettes',
        charset: 'utf-8',
        viewport: 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=0, viewport-fit=cover, interactive-widget=resizes-content',
      }
    },
    css: ['~/assets/css/main.css'],
    runtimeConfig: {
        token: '',
        sa: '',
        session: { password: '' },
        oauth: { google: { clientId: '', clientSecret: '' } },
        // SMTP (Gmail app password). Env vars: NUXT_SMTP_USER, NUXT_SMTP_PASSWORD.
        smtp: { user: '', password: '' },
        // HelloAsso Checkout API client. Env vars: NUXT_HELLOASSO_CLIENT_ID,
        // NUXT_HELLOASSO_CLIENT_SECRET, NUXT_HELLOASSO_SANDBOX ('true' to use
        // api.helloasso-sandbox.com instead of api.helloasso.com).
        helloasso: { clientId: '', clientSecret: '', sandbox: '' },
        // Absolute origin used to build the /pay/[name] link in recap emails.
        // Env var: NUXT_PUBLIC_SITE_URL (e.g. https://cashier.augny-badminton.fr)
        publicSiteUrl: '',
    },
    postcss: {
        plugins: {
            tailwindcss: {},
            autoprefixer: {},
        },
    },
})
