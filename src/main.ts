import './main.css'
import Vue3TouchEvents from 'vue3-touch-events'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)
app.use(createPinia())
// app.use(Vue3TouchEvents)

app.mount('#app')
