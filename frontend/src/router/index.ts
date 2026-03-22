import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '@/views/LoginView.vue'
import EditorView from '@/views/EditorView.vue'

function getUser(): string | null {
  return localStorage.getItem('user')
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'login', component: LoginView },
    { path: '/editor', name: 'editor', component: EditorView, meta: { requiresAuth: true } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !getUser()) return { name: 'login' }
  if (to.name === 'login' && getUser()) return { name: 'editor' }
})

export default router
