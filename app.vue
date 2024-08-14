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

const { data: players } = await useFetch('/api/players', {
  headers: {'X-Token': token}
});
const { data: comite } = await useFetch('/api/comitee', {
  headers: {
    "X-Token": token
  }
});
const { data: items } = await useFetch('/api/prices', {
  headers: {
    "X-Token": token
  }
});


const randomPlayer = players.value['data'][Math.floor(Math.random() * players.value['data'].length)]

const player = ref('')
const playerSelected = ref(false)

const item = ref('')

const quantity = ref(1)

const completed = ref(false)
const loading = ref(false)
const error = ref(false)

const filteredPlayers = computed(() => {
  if (player.value.length < 3) {
    return []
  }
  return players.value['data'].filter(p =>
      p['Nom'].toLowerCase().includes(player.value.toLowerCase())
  )
})

const onInput = () => {
  playerSelected.value = false;
}

const Euro = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

const submit = async () => {
  loading.value = true
  for(let i =0; i < quantity.value; i++) {
    const {data: response, status: s} = await useFetch('/api/push', {
      method: 'POST',
      headers: {
        "X-Token": token
      },
      body: {
        data: [player.value, item.value['Item'], item.value['Prix'], new Date().toJSON().slice(0,10).replace(/-/g,'/')],
      },
    });
    if (s.value !== 'success') {
      error.value = true
    }
  }
  completed.value = true
  loading.value = false
}

</script>
<template>
  <div>
    <NuxtRouteAnnouncer />
    <nav class="border-gray-200 bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
      <div class="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
        <a href="#" class="flex items-center space-x-3">
          <img src="assets/images/logo.png" class="w-24" alt="Flowbite Logo" />
          <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">Cashier</span>
        </a>
      </div>
    </nav>
    <form class="max-w-sm mx-auto">
      <template v-if="!completed">
        <label for="email-address-icon" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Adhérent</label>
        <div class="relative">
          <div class="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none">
            <svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
              <path stroke="currentColor" stroke-width="2" d="M7 17v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3Zm8-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
            </svg>
          </div>
          <input autocomplete="off" @input="onInput" v-model="player" type="text" id="email-address-icon" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full ps-10 p-2.5  dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" :placeholder="randomPlayer['Nom']">
        </div>
        <div class="relative" v-if="filteredPlayers.length > 0 && playerSelected == false">
          <div class="max-w-sm mx-auto mt-6" v-for="p in filteredPlayers">
            <div v-on:click="player = p['Nom']; playerSelected = true" class="w-full p-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg hover:bg-blue-100 dark:hover:bg-gray-700 transition-colors duration-300">
              <div class="text-center">
                <p class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {{ p['Nom'].split(' ')[0] }}
                </p>
                <p class="text-sm text-blue-600 dark:text-blue-400">
                  {{ p['Nom'].split(' ')[1] }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="grid grid-cols-3 gap-4 mt-5" v-if="playerSelected && !item && !completed">
        <div v-on:click="item = i" v-for="i in items['data']" class="w-full p-4 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors duration-300">
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

      <div class="max-w-sm mx-auto mt-6" v-if="item && !completed">
        <button class="w-full p-4 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors duration-300">
          <div class="flex items-center justify-between">
            <!-- Content Container -->
            <div class="flex-1">
              <!-- Category -->
              <p class="text-sm font-medium text-gray-600 dark:text-gray-400">
                {{ item['Catégorie'] }}
              </p>

              <!-- Item Name -->
              <p class="text-lg font-semibold text-black dark:text-white mt-1">
                {{ item['Item'] }}
              </p>
            </div>

            <!-- Price -->
            <p class="text-sm font-semibold text-blue-600 dark:text-blue-400">
              {{ item['Prix'] }}
            </p>
          </div>
        </button>
      </div>

      <template v-if="playerSelected && item && !completed">
        <div class="relative flex items-center max-w-sm mx-auto mt-6" >
          <button v-on:click="quantity--" type="button" id="decrement-button" data-input-counter-decrement="quantity-input" class="bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:border-gray-600 hover:bg-gray-200 border border-gray-300 rounded-s-lg p-12 h-32 focus:ring-gray-100 dark:focus:ring-gray-700 focus:ring-2 focus:outline-none">
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

      <template v-if="playerSelected && item && quantity > 0 && !completed">
        <div class="fixed inset-x-0 bottom-0 p-4">
          <div v-on:click="submit()" class="w-full bg-blue-600 text-white text-lg font-semibold py-4 rounded-lg shadow-lg flex items-center justify-center space-x-4 hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors duration-300">
            <!-- Price -->
            <span class=" bg-white text-blue-600 text-lg font-bold py-2 px-4 rounded-md">
              {{ Euro.format(quantity * parseFloat(item['Prix'].split(' ')[0]))}}
            </span>
            <!-- Button Text -->
            <span v-if="!loading">Enregistrer la dette</span>
            <span v-if="loading">En cours ...</span>

          </div>
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

  </div>
</template>

<style>
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

