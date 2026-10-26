import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Dashboard from './pages/Dashboard.vue';
import Inbox from './pages/Inbox.vue';
import Knowledge from './pages/Knowledge.vue';
import Detail from './pages/Detail.vue';
import Search from './pages/Search.vue';
import Watch from './pages/Watch.vue';
import './style.css';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/inbox', component: Inbox },
    { path: '/knowledge', component: Knowledge },
    { path: '/knowledge/:id', component: Detail },
    { path: '/search', component: Search },
    { path: '/watch', component: Watch },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
createApp(App).use(router).mount('#app');
