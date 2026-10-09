<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAppStore } from '@/stores/app'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const userStore = useUserStore()

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

const title = computed(() => appStore.loginPageConfig.title || 'QQ农场智能助手')
const subtitle = computed(() => appStore.loginPageConfig.loginSubtitle || '欢迎回来，开启智慧农耕之旅')
const logoUrl = computed(() => appStore.loginPageConfig.logoUrl || '/icon.png')

function resolveRedirect(): string {
  const redirect = route.query.redirect
  const value = Array.isArray(redirect) ? redirect[0] : redirect
  // 仅允许站内路径，避免开放重定向。
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//'))
    return value
  return '/'
}

async function handleSubmit() {
  if (loading.value)
    return

  errorMessage.value = ''
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入用户名和密码'
    return
  }

  loading.value = true
  try {
    await userStore.login(username.value.trim(), password.value)
    await router.replace(resolveRedirect())
  }
  catch (error: any) {
    errorMessage.value = error?.response?.data?.error || error?.message || '登录失败，请重试'
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
})
</script>

<template>
  <div class="relative min-h-screen w-full flex items-center justify-center overflow-hidden px-4 py-10">
    <!-- 背景装饰 -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        class="absolute h-72 w-72 rounded-full opacity-30 blur-3xl -left-24 -top-24"
        :style="{ background: 'var(--theme-gradient)' }"
      />
      <div
        class="absolute h-80 w-80 rounded-full opacity-20 blur-3xl -bottom-32 -right-16"
        :style="{ background: 'var(--theme-gradient)' }"
      />
    </div>

    <div class="absolute right-3 top-3 z-10">
      <ThemeToggle />
    </div>

    <div class="glass-panel relative z-[1] max-w-md w-full rounded-2xl p-7 md:p-9">
      <div class="flex flex-col items-center text-center">
        <div class="h-16 w-16 flex items-center justify-center overflow-hidden rounded-2xl ring-1 ring-gray-200/70 dark:ring-gray-700/70">
          <img :src="logoUrl" :alt="title" class="h-full w-full object-cover">
        </div>
        <h1 class="mt-4 text-xl text-gray-900 font-semibold md:text-2xl dark:text-gray-100">
          {{ title }}
        </h1>
        <p class="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
          {{ subtitle }}
        </p>
      </div>

      <form class="mt-7 flex flex-col gap-4" @submit.prevent="handleSubmit">
        <BaseInput
          v-model="username"
          label="用户名"
          placeholder="请输入用户名"
          :disabled="loading"
        />
        <BaseInput
          v-model="password"
          type="password"
          label="密码"
          placeholder="请输入密码"
          :disabled="loading"
        />

        <div
          v-if="errorMessage"
          class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300"
        >
          {{ errorMessage }}
        </div>

        <BaseButton
          type="submit"
          variant="primary"
          size="lg"
          block
          :loading="loading"
          :disabled="loading"
        >
          登录
        </BaseButton>
      </form>

      <p class="mt-6 text-center text-xs text-gray-400">
        仅限授权用户访问 · 账号由服务端配置
      </p>
    </div>
  </div>
</template>
