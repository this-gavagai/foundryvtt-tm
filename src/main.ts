import './main.css'
import { createApp } from 'vue'
import { GesturePlugin } from '@vueuse/gesture'

import App from './App.vue'

window.__TM_ENV__ = {
  MODE: import.meta.env.MODE,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD
}

const app = createApp(App)
app.use(GesturePlugin)

app.mixin({
  mounted() {
    const name = this.$options.name ?? this.$options.__name
    if (name && this.$el && this.$el.setAttribute) {
      this.$el.setAttribute('data-component', name)
    }
  }
})

app.mount('#app')
