<script setup lang="ts">
import {createError} from "h3";

const route = useRoute()
const routeToken = route.query.token
const cookieToken = useCookie('token')
let token = ''

if (!cookieToken.value && !routeToken) {
  throw createError({ statusCode: 401, statusMessage: 'Not authorized' });
} else if (cookieToken.value) {
  token = cookieToken.value
} else {
  token = routeToken
}

const { data: players, status: playersFetch } = await useAsyncData(
    'players',
    () => $fetch('/api/players', {
      headers: {
        "X-Token": token
      }
    }),
    {
      server: false,
      lazy: true
    }
)
const { data: items, status: itemsFetch } = await useAsyncData(
    'items',
    () => $fetch('/api/prices', {
      headers: {
        "X-Token": token
      }
    }),
    {
      server: false,
      lazy: true
    }
)

const randomPlayer = computed(() => {
  if(players.value == null) {
    return {'Nom': ''}
  } else {
    return players.value['data'][Math.floor(Math.random() * players.value['data'].length)]
  }
})

const player = ref('')
const playerSelected = ref(false)

const item = ref({})
const itemSelected = ref(false)

const quantity = ref(1)

const completed = ref(false)
const loading = ref(false)
const error = ref(false)

const filteredPlayers = computed(() => {
  if (player.value.length < 3 || players.value == null) {
    return []
  }
  return players.value['data'].filter(p =>
      p['Nom'].toLowerCase().includes(player.value.toLowerCase())
  )
})

const onInput = () => {
  playerSelected.value = false;
}

const refetching = ref(false)
const showRefetchButton = ref(false)
let refetchTimer: ReturnType<typeof setTimeout> | null = null

watch(filteredPlayers, (results) => {
  showRefetchButton.value = false
  if (refetchTimer) clearTimeout(refetchTimer)
  if (results.length === 0 && player.value.length >= 3) {
    refetchTimer = setTimeout(() => { showRefetchButton.value = true }, 2500)
  }
})

const refetchPlayers = async () => {
  showRefetchButton.value = false
  refetching.value = true
  try {
    // Trigger Poona → sheet sync. Response shape: { total, added[], removed[] }.
    await $fetch('https://update-poona.jalbrecht.fr/')
    // Then pick up the freshly-updated member list from the sheet.
    const result = await $fetch('/api/players', {
      headers: { "X-Token": token }
    })
    players.value = result
  } finally {
    refetching.value = false
  }
}

const searchOpen = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)

const openSearch = () => {
  searchOpen.value = true
  nextTick(() => searchInputEl.value?.focus())
}

const closeSearch = () => {
  searchOpen.value = false
  player.value = ''
}

const selectPlayer = (p: Record<string, string>) => {
  player.value = p['Nom']
  playerSelected.value = true
  searchOpen.value = false
  fetchBalance()
}

// --- Live balance badge ---
const balance = ref<number | null>(null)
const balanceLoading = ref(false)
const balanceError = ref(false)

const fetchBalance = async () => {
  if (!player.value) return
  balanceLoading.value = true
  balanceError.value = false
  balance.value = null
  try {
    const res = await $fetch<{ total: number }>(
      `/api/balance/${encodeURIComponent(player.value)}`,
      { headers: { "X-Token": token } },
    )
    balance.value = res.total
  } catch (e) {
    balanceError.value = true
  } finally {
    balanceLoading.value = false
  }
}

const balanceClass = computed(() => {
  if (balance.value == null) return ''
  if (balance.value > 0.01) return 'text-red-600 dark:text-red-400'
  if (balance.value < -0.01) return 'text-green-600 dark:text-green-400'
  return 'text-gray-500'
})

const balanceLabel = computed(() => {
  if (balance.value == null) return ''
  if (balance.value > 0.01) return 'doit'
  if (balance.value < -0.01) return 'crédit'
  return 'à jour'
})

const Euro = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

const deselectPlayer = () => {
  player.value = ''
  playerSelected.value = false
  item.value = {}
  itemSelected.value = false
  quantity.value = 1
  balance.value = null
  balanceError.value = false
}

const deselectItem = () => {
  item.value = {}
  itemSelected.value = false
  quantity.value = 1
}


const submit = async () => {
  loading.value = true
  error.value = false
  try {
    for (let i = 0; i < quantity.value; i++) {
      await $fetch('/api/push', {
        method: 'POST',
        headers: { "X-Token": token },
        body: {
          data: [player.value, item.value['Item'], item.value['Prix'], new Date().toJSON().slice(0,10).replace(/-/g,'/')],
        },
      })
    }
    // Refresh the badge so the cashier sees the new running balance.
    fetchBalance()
  } catch (e) {
    error.value = true
  }
  completed.value = true
  loading.value = false
}

</script>
<template>

  <div>
    <NuxtRouteAnnouncer />
    <nav class="border-gray-200 bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
      <div v-on:click="reloadNuxtApp()" class="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
        <a href="#" class="flex items-center space-x-3">
          <img src="assets/images/logo.png" class="w-24" alt="Augny Badminton logo" />
          <svg v-if="playersFetch != 'success' && itemsFetch != 'success'" aria-hidden="true" class="w-4 h-4 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
            <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
          </svg>
          <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">Cashier</span>
        </a>
        <NuxtLink
          to="/dettes"
          @click.stop
          class="ml-auto inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <svg class="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 3h18M3 9h18M3 15h18M3 21h18" />
          </svg>
          <span>Dettes</span>
        </NuxtLink>
      </div>
    </nav>
    <form class="max-w-sm mx-auto mt-2">
      <template v-if="!completed && playerSelected">
        <label for="player-input" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Adhérent</label>
        <div class="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
          <div class="flex items-center space-x-3">
            <svg class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
              <path stroke="currentColor" stroke-width="2" d="M7 17v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3Zm8-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
            </svg>
            <p class="text-base font-semibold text-gray-900 dark:text-white">{{ player }}</p>
          </div>
          <button type="button" @click="deselectPlayer()" class="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200">Changer</button>
        </div>
        <!-- Payment link — shown before the debt badge so it's the first thing seen -->
        <a
          v-if="balance != null && balance > 0.01"
          :href="`/pay/${encodeURIComponent(player)}`"
          target="_blank"
          rel="noopener"
          class="mt-2 flex items-center justify-center gap-2 w-full px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-md transition-colors"
        >
          💳 Payer par CB (HelloAsso)
        </a>

        <!-- Live balance badge -->
        <div class="mt-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-sm flex items-center justify-between">
          <span class="text-gray-500 dark:text-gray-400">Solde actuel</span>
          <span v-if="balanceLoading" class="text-gray-400">…</span>
          <span v-else-if="balanceError" class="text-gray-400 text-xs">indisponible</span>
          <span v-else-if="balance != null" :class="balanceClass" class="font-semibold tabular-nums">
            {{ Euro.format(balance) }}
            <span class="text-xs font-normal ml-1 opacity-70">({{ balanceLabel }})</span>
          </span>
        </div>
      </template>

      <div v-if="!playerSelected && !completed" class="fixed inset-x-0 bottom-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        <button type="button" @click="openSearch()"
                class="w-full flex items-center gap-3 px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-base text-gray-400 dark:text-gray-500">
          <svg class="w-4 h-4 shrink-0" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
          </svg>
          <span>Rechercher un adhérent…</span>
        </button>
      </div>

      <div v-if="!playerSelected && !completed"
           class="flex flex-col items-center justify-center gap-6 pb-28"
           style="min-height: calc(100svh - 72px)">

        <span class="text-8xl select-none" aria-hidden="true">🏸</span>

        <p class="text-sm font-medium text-gray-400 dark:text-gray-500">Sélectionner un adhérent</p>

        <!-- Cascading arrows pointing toward the search bar -->
        <div class="flex flex-col items-center -gap-1">
          <svg class="w-6 h-6 text-gray-300 dark:text-gray-600 arrow-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/>
          </svg>
          <svg class="w-6 h-6 text-gray-300 dark:text-gray-600 arrow-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/>
          </svg>
          <svg class="w-6 h-6 text-gray-300 dark:text-gray-600 arrow-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/>
          </svg>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-4 mt-5" v-if="playerSelected && !itemSelected && !completed">
        <div v-on:click="item = i; itemSelected = true;" v-for="i in items['data']" class="w-full p-4 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors duration-300">
          <div class="text-center">
            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
              {{ i['Catégorie'] }}
            </p>
            <p class="text-lg font-semibold text-black dark:text-white mt-1">
              {{ i['Item'] }}
            </p>
            <p class="text-lg font-semibold text-blue-500 dark:text-gray-100 mt-2">
              {{ i['Prix'] }}
            </p>
          </div>
        </div>
      </div>

      <div class="max-w-sm mx-auto mt-6" v-if="itemSelected && !completed">
        <button type="button" @click="deselectItem()" class="w-full p-4 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors duration-300">
          <div class="flex items-center justify-between">
            <div class="flex-1 text-left">
              <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
                {{ item['Catégorie'] }}
              </p>
              <p class="text-lg font-semibold text-black dark:text-white mt-1">
                {{ item['Item'] }}
              </p>
            </div>
            <div class="flex items-center space-x-3">
              <p class="text-sm font-semibold text-blue-600 dark:text-blue-400">
                {{ Euro.format(parseFloat(('' + item['Prix']).split(' ')[0])) }}
              </p>
              <span class="text-xs text-gray-400 dark:text-gray-500">Changer</span>
            </div>
          </div>
        </button>
      </div>

      <template v-if="playerSelected && itemSelected && !completed && item['Catégorie'] == 'Spécial'">
        <div class="mt-6">
          <label for="amount" class="block mb-2 text-sm font-medium text-gray-900">Montant</label>
          <div class="relative">
            <div class="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none">
              <svg class="w-6 h-6 text-gray-800 dark:text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M19 7.11111C17.775 5.21864 15.8556 4 13.6979 4C9.99875 4 7 7.58172 7 12C7 16.4183 9.99875 20 13.6979 20C15.8556 20 17.775 18.7814 19 16.8889M5 10H14M5 14H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
            </div>
            <input autocomplete="off" v-model="item['Prix']" type="number" min="0.00" max="10000.00" step="0.01" id="amount" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full ps-10 p-2.5  dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="0.00€">
          </div>
        </div>
        <div class="mt-6">
          <label for="reason" class="block mb-2 text-sm font-medium text-gray-900">Intitulé</label>
          <div class="relative">
            <div class="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none">
              <svg class="w-6 h-6 text-gray-800 dark:text-white"  viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path stroke="currentColor" d="M14.635 2.217a.74.74 0 0 0-1.048 0l-10.37 10.37a.74.74 0 0 0-.217.524v5.185a.741.741 0 0 0 .217.524l2.286 2.286c-.247.6-.513.881-.722.881-.429 0-.846-.58-.982-.86l-.086-.18-1.037.493.085.18c.029.063.728 1.518 2.02 1.518a1.853 1.853 0 0 0 1.608-1.215.732.732 0 0 0 .315.077h5.185a.741.741 0 0 0 .524-.217l10.37-10.37a.74.74 0 0 0 0-1.048zM11.782 21H6.81l-.043-.043a10.076 10.076 0 0 0 .258-1.005 2.533 2.533 0 1 0-1.056-.488c-.022.079-.05.152-.066.235-.023.115-.048.216-.072.322L4 18.189v-4.97L14.11 3.106l7.783 7.782zM6 17.5A1.5 1.5 0 1 1 7.5 19c-.021 0-.04-.005-.062-.006a2.873 2.873 0 0 1 .61-.647l.16-.114-.649-.946-.165.115A4.018 4.018 0 0 0 6.39 18.5a1.489 1.489 0 0 1-.39-1zm2.542-5.792l5.922-5.922.707.707-5.922 5.923zm2.021 2.022l5.922-5.922.707.707-5.922 5.922zm2.021 2.021l5.923-5.922.707.707-5.922 5.922z"></path><path fill="none" d="M0 0h24v24H0z"></path></g></svg>
            </div>
            <input autocomplete="off" v-model="item['Item']" type="text" id="reason" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full ps-10 p-2.5  dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="0.00€">
          </div>
        </div>
      </template>

      <template v-if="playerSelected && itemSelected && !completed">
        <div class="relative flex items-center max-w-sm mx-auto mt-6" >
          <button v-on:click="quantity = Math.max(1, quantity - 1)" type="button" id="decrement-button" data-input-counter-decrement="quantity-input" class="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-s-lg p-12 h-32 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none">
            <svg class="w-3 h-3 text-gray-900 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 18 2">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M1 1h16"/>
            </svg>
          </button>
          <input v-model="quantity" type="text" id="quantity-input" data-input-counter aria-describedby="helper-text-explanation" class="bg-gray-50 border-x-0 border-gray-300 h-32 text-center text-gray-900 text-6xl focus:ring-blue-500 focus:border-blue-500 block w-full py-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="999" required />
          <button v-on:click="quantity++" type="button" id="increment-button" data-input-counter-increment="quantity-input" class="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-e-lg p-12 h-32 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none">
            <svg class="w-3 h-3 text-gray-900 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 18 18">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 1v16M1 9h16"/>
            </svg>
          </button>
        </div>
      </template>

      <template v-if="playerSelected && itemSelected && quantity > 0 && !completed">
        <div class="fixed inset-x-0 bottom-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button type="button" @click="submit()" :disabled="loading" class="w-full bg-blue-600 text-white text-lg font-semibold py-4 rounded-lg shadow-lg flex items-center justify-center space-x-4 hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed">
            <span class="bg-white text-blue-600 text-lg font-bold py-2 px-4 rounded-md">
              {{ Euro.format(quantity * parseFloat(('' + item['Prix']).split(' ')[0]))}}
            </span>
            <span v-if="!loading">Enregistrer la dette</span>
            <span v-if="loading">En cours ...</span>
          </button>
        </div>
      </template>

    </form>

    <template v-if="completed && !loading && !error">
      <div class="grid h-screen place-items-center">
        <div>
          <div class="success-checkmark ">
            <div class="check-icon">
              <span class="icon-line line-tip"></span>
              <span class="icon-line line-long"></span>
              <div class="icon-circle"></div>
              <div class="icon-fix"></div>
            </div>
          </div>
          <p>Dette enregistrée</p>
          <div v-on:click="reloadNuxtApp()" class="mt-5 cursor-pointer text-white bg-gradient-to-br from-purple-600 to-blue-500 hover:bg-gradient-to-bl focus:ring-4 focus:outline-none focus:ring-blue-300 dark:focus:ring-blue-800 font-medium rounded-lg text-sm px-5 py-2.5 text-center me-2 mb-2">Recommencer</div>
        </div>
      </div>
    </template>

    <template v-if="error">
      <div class="grid h-screen place-items-center">
        <div>
          <p>Erreur lors de l'enregistrement</p>
          <div v-on:click="reloadNuxtApp()" class="mt-5 cursor-pointer text-white bg-gradient-to-br from-purple-600 to-blue-500 hover:bg-gradient-to-bl focus:ring-4 focus:outline-none focus:ring-blue-300 dark:focus:ring-blue-800 font-medium rounded-lg text-sm px-5 py-2.5 text-center me-2 mb-2">Recommencer</div>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <Transition name="search">
        <div v-if="searchOpen" class="search-overlay fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
          <!-- Search header pinned to the top — iOS keyboard covers the bottom
               half of the screen, so a bottom-anchored input gets hidden. The
               Spotlight/Slack/Gmail pattern puts search at the top instead. -->
          <div class="search-overlay-header flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div class="relative flex-1">
              <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <svg class="w-4 h-4 text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
                </svg>
              </div>
              <input
                ref="searchInputEl"
                v-model="player"
                @input="onInput"
                type="text"
                id="player-input"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                class="w-full pl-10 pr-4 py-2.5 bg-gray-100 dark:bg-gray-800 rounded-xl border-0 text-gray-900 dark:text-white text-base focus:ring-0 focus:outline-none"
                placeholder="Rechercher un adhérent"
              >
            </div>
            <button type="button" @click="closeSearch()" class="text-blue-600 dark:text-blue-400 font-medium text-base whitespace-nowrap shrink-0">
              Annuler
            </button>
          </div>
          <div class="flex-1 overflow-y-auto overscroll-contain">
            <p v-if="player.length === 0" class="px-4 py-6 text-center text-sm text-gray-400">
              Commencez à taper un nom…
            </p>
            <p v-else-if="player.length < 3" class="px-4 py-6 text-center text-sm text-gray-400">
              Entrez au moins 3 caractères…
            </p>
            <div v-else-if="filteredPlayers.length === 0" class="px-4 py-6 flex flex-col items-center gap-4">
              <p class="text-center text-sm text-gray-400">
                Aucun résultat pour «&nbsp;{{ player }}&nbsp;»
              </p>
              <Transition name="refetch-fade">
                <button
                  v-if="showRefetchButton && !refetching"
                  type="button"
                  @click="refetchPlayers"
                  class="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-xl text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                >
                  <svg class="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Actualiser depuis Poona
                </button>
              </Transition>
              <div v-if="refetching" class="flex items-center gap-2 text-sm text-gray-400">
                <svg aria-hidden="true" class="w-4 h-4 animate-spin text-gray-300 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                  <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                </svg>
                Chargement en cours…
              </div>
            </div>
            <button
              v-for="p in filteredPlayers"
              :key="p['Nom']"
              type="button"
              @click="selectPlayer(p)"
              class="w-full flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
            >
              <div class="text-left">
                <p class="text-base font-semibold text-gray-900 dark:text-white">{{ p['Nom'].split(' ')[0] }}</p>
                <p class="text-sm text-blue-600 dark:text-blue-400">{{ p['Nom'].split(' ').slice(1).join(' ') }}</p>
              </div>
              <svg class="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style>
@keyframes arrow-fade {
  0%, 100% { opacity: 0.15; }
  50%       { opacity: 0.9;  }
}
.arrow-1 { animation: arrow-fade 1.6s ease-in-out infinite; }
.arrow-2 { animation: arrow-fade 1.6s ease-in-out infinite 0.27s; }
.arrow-3 { animation: arrow-fade 1.6s ease-in-out infinite 0.54s; }

.refetch-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.refetch-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.search-enter-active,
.search-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.search-enter-from,
.search-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

/* iOS Safari: fixed inset-0 sits behind the URL bar. Push the search header
   down by the safe area inset so the input isn't covered. The input is
   anchored at the top so the on-screen keyboard can't hide it. */
.search-overlay-header {
  padding-top: calc(0.75rem + env(safe-area-inset-top));
}

.success-checkmark {
  width: 80px;
  height: 115px;
  margin: 0 auto;

  .check-icon {
    width: 80px;
    height: 80px;
    position: relative;
    border-radius: 50%;
    box-sizing: content-box;
    border: 4px solid #4CAF50;

    &::before {
      top: 3px;
      left: -2px;
      width: 30px;
      transform-origin: 100% 50%;
      border-radius: 100px 0 0 100px;
    }

    &::after {
      top: 0;
      left: 30px;
      width: 60px;
      transform-origin: 0 50%;
      border-radius: 0 100px 100px 0;
      animation: rotate-circle 4.25s ease-in;
    }

    &::before, &::after {
      content: '';
      height: 100px;
      position: absolute;
      background: #FFFFFF;
      transform: rotate(-45deg);
    }

    .icon-line {
      height: 5px;
      background-color: #4CAF50;
      display: block;
      border-radius: 2px;
      position: absolute;
      z-index: 10;

      &.line-tip {
        top: 46px;
        left: 14px;
        width: 25px;
        transform: rotate(45deg);
        animation: icon-line-tip 0.75s;
      }

      &.line-long {
        top: 38px;
        right: 8px;
        width: 47px;
        transform: rotate(-45deg);
        animation: icon-line-long 0.75s;
      }
    }

    .icon-circle {
      top: -4px;
      left: -4px;
      z-index: 10;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      position: absolute;
      box-sizing: content-box;
      border: 4px solid rgba(76, 175, 80, .5);
    }

    .icon-fix {
      top: 8px;
      width: 5px;
      left: 26px;
      z-index: 1;
      height: 85px;
      position: absolute;
      transform: rotate(-45deg);
      background-color: #FFFFFF;
    }
  }
}

@keyframes rotate-circle {
  0% {
    transform: rotate(-45deg);
  }
  5% {
    transform: rotate(-45deg);
  }
  12% {
    transform: rotate(-405deg);
  }
  100% {
    transform: rotate(-405deg);
  }
}

@keyframes icon-line-tip {
  0% {
    width: 0;
    left: 1px;
    top: 19px;
  }
  54% {
    width: 0;
    left: 1px;
    top: 19px;
  }
  70% {
    width: 50px;
    left: -8px;
    top: 37px;
  }
  84% {
    width: 17px;
    left: 21px;
    top: 48px;
  }
  100% {
    width: 25px;
    left: 14px;
    top: 45px;
  }
}

@keyframes icon-line-long {
  0% {
    width: 0;
    right: 46px;
    top: 54px;
  }
  65% {
    width: 0;
    right: 46px;
    top: 54px;
  }
  84% {
    width: 55px;
    right: 0px;
    top: 35px;
  }
  100% {
    width: 47px;
    right: 8px;
    top: 38px;
  }
}
</style>

