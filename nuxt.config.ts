// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2024-04-03',
    devtools: {enabled: true},
    app: {
    title: 'Augny Badminton Cashier - Enregistrement des dettes',
      head: {
        charset: 'utf-8',
        viewport: 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=0',
      }
    },
    css: ['~/assets/css/main.css'],
    runtimeConfig: {
        token: '',
        sa: '',
    },
    postcss: {
        plugins: {
            tailwindcss: {},
            autoprefixer: {},
        },
    },
})
