import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

interface AdminUser {
  username: 'admin'
  role: 'admin'
  card: null
  accountLimit: number
  avatar?: string
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<AdminUser | null>('user_info', null)
  const authRequired = ref(false)

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => true)
  const isSuperAdmin = computed(() => false)
  const username = computed(() => 'admin')
  const avatar = computed(() => userInfo.value?.avatar || '')
  const accountLimit = computed(() => Number.MAX_SAFE_INTEGER)
  const isExpired = computed(() => false)

  let authConfigPromise: Promise<boolean> | null = null

  /** 查询后端是否启用登录；结果在会话内缓存。 */
  async function fetchAuthConfig(): Promise<boolean> {
    if (authConfigPromise)
      return authConfigPromise

    authConfigPromise = api.get('/api/auth/config', { timeout: 6000 })
      .then(({ data }) => {
        authRequired.value = !!data?.data?.authRequired
        return authRequired.value
      })
      .catch(() => {
        authRequired.value = false
        return false
      })
    return authConfigPromise
  }

  async function login(usernameInput: string, password: string) {
    const { data } = await api.post(
      '/api/login',
      { username: usernameInput, password },
      { skipErrorToast: true } as any,
    )
    if (!data?.ok)
      throw new Error(data?.error || '登录失败')

    token.value = data.data.token
    userInfo.value = {
      username: 'admin',
      role: 'admin',
      card: null,
      accountLimit: data.data.accountLimit ?? Number.MAX_SAFE_INTEGER,
    }
    authRequired.value = true
    return data
  }

  async function logout() {
    try {
      await api.post('/api/logout', {}, { skipErrorToast: true } as any)
    }
    catch {
      // 忽略登出请求失败，本地状态仍要清理。
    }
    token.value = ''
    userInfo.value = null
    // 整页跳转以断开 socket 及清理内存态。
    window.location.href = '/login'
  }

  async function fetchUserInfo() {
    try {
      const { data } = await api.get('/api/user/me')
      if (data?.ok) {
        userInfo.value = {
          username: 'admin',
          role: 'admin',
          card: null,
          accountLimit: Number.MAX_SAFE_INTEGER,
          avatar: data.data.avatar,
        }
      }
      return data
    }
    catch {
      return { ok: false }
    }
  }

  return {
    token,
    userInfo,
    authRequired,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    avatar,
    accountLimit,
    isExpired,
    fetchAuthConfig,
    login,
    logout,
    fetchUserInfo,
  }
})
