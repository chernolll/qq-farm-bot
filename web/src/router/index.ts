import { useStorage } from '@vueuse/core'
import axios from 'axios'
import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const adminToken = useStorage('admin_token', '')
const userInfo = useStorage('user_info', '')
let autoLoginPromise: Promise<boolean> | null = null
let autoLoginAttempted = false

/** 未启用登录时的免登录流程（保持旧行为）。 */
async function ensureAutoLogin() {
  if (adminToken.value || autoLoginAttempted)
    return true

  if (!autoLoginPromise) {
    autoLoginAttempted = true
    autoLoginPromise = axios.post('/api/auto-login', {}, { timeout: 6000 })
      .then(({ data }) => {
        if (!data?.ok)
          return false
        adminToken.value = data.data.token
        userInfo.value = JSON.stringify({
          username: 'admin',
          role: 'admin',
          card: null,
          accountLimit: data.data.accountLimit,
          mustChangePassword: false,
        })
        return true
      })
      .catch(() => false)
      .finally(() => { autoLoginPromise = null })
  }
  return autoLoginPromise
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    { path: '/admin', redirect: '/settings?tab=system' },
    { path: '/renewal', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  NProgress.start()

  const userStore = useUserStore()
  const authRequired = await userStore.fetchAuthConfig()

  // 未启用登录：维持免登录行为，访问登录页直接回首页。
  if (!authRequired) {
    if (to.path === '/login')
      return { path: '/' }
    await ensureAutoLogin()
    return true
  }

  // 已启用登录。
  if (to.path === '/login')
    return adminToken.value ? { path: '/' } : true

  if (!adminToken.value) {
    const redirect = to.fullPath && to.fullPath !== '/' ? to.fullPath : undefined
    return { path: '/login', query: redirect ? { redirect } : {} }
  }

  return true
})

router.afterEach(() => NProgress.done())

export default router
