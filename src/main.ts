import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { byteSourceFactoryKey, defaultByteSourceFactory } from './byteSourceFactory'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.provide(byteSourceFactoryKey, defaultByteSourceFactory)

app.mount('#app')
