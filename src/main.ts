import './main.css'
import { createApp } from 'vue'
import { GesturePlugin } from '@vueuse/gesture'

import App from './App.vue'

const app = createApp(App)
app.use(GesturePlugin)
app.mount('#app')
