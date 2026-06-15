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
        viewport: 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=0, viewport-fit=cover',
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
    },
    postcss: {
        plugins: {
            tailwindcss: {},
            autoprefixer: {},
        },
    },
})
