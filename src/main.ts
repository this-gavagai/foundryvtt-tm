import './main.css'
import { createApp, reactive } from 'vue'
import { useWakeLock } from '@vueuse/core'

import App from './App.vue'

const app = createApp(App)
app.mount('#app')

// TODO: (bug) figure out why wakelock isn't working correctly
const wakeLock = reactive(useWakeLock())
wakeLock.request('screen')
