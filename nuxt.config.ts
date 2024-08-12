// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2024-04-03',
    devtools: {enabled: true},
    app: {
      head: {
        charset: 'utf-8',
        viewport: 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=0',
      }
    },
    css: ['~/assets/css/main.css'],
    runtimeConfig: {
        sa: '',
    },
    postcss: {
        plugins: {
            tailwindcss: {},
            autoprefixer: {},
        },
    },
    modules: ["@kgierke/nuxt-basic-auth"],
    basicAuth: {
        enabled: true,
        users: [
            {
                username: "augny",
                password: process.env.PASSWORD || 'augny',
            },
        ],
    }
})
