import './main.css'
import { createApp } from 'vue'
import { useWakeLock } from '@vueuse/core'
import { GesturePlugin } from '@vueuse/gesture'

import App from './App.vue'

const app = createApp(App)
app.use(GesturePlugin)
app.mount('#app')

// TODO (bug): figure out why wakelock isn't working correctly
const { request } = useWakeLock()
document.addEventListener(
  'click',
  function enableNoSleep() {
    document.removeEventListener('click', enableNoSleep, false)
    request('screen')
  },
  false
)
