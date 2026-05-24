import './main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { GesturePlugin } from '@vueuse/gesture'

import App from './App.vue'
import { i18n } from '@/plugins/i18n'

window.__TM_ENV__ = {
  MODE: import.meta.env.MODE,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD
}

const pinia = createPinia()
const app = createApp(App)

app.use(GesturePlugin)
app.use(i18n)
app.use(pinia)

app.mixin({
  mounted() {
    const name = this.$options.name ?? this.$options.__name
    if (name && this.$el && this.$el.setAttribute) {
      this.$el.setAttribute('data-component', name)
    }
  }
})

app.mount('#app')
