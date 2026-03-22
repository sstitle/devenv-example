<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Card from '@/components/ui/Card.vue'

const USERS: Record<string, { color: string }> = {
  alice: { color: '#e74c3c' },
  bob:   { color: '#3498db' },
}

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true

  // Simulate a brief async operation so the loading state is visible
  await new Promise((r) => setTimeout(r, 300))

  const name = username.value.trim().toLowerCase()
  if (!USERS[name]) {
    error.value = 'Unknown user. Try alice or bob.'
    loading.value = false
    return
  }

  localStorage.setItem('user', JSON.stringify({ name, color: USERS[name]!.color }))
  loading.value = false
  router.push('/editor')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="flex flex-col items-center gap-2 text-center">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
          C
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">collab</h1>
      </div>

      <Card class="p-6">
        <form class="space-y-4" @submit.prevent="handleLogin">
          <div class="space-y-1">
            <h2 class="text-lg font-semibold">Welcome back</h2>
            <p class="text-sm text-muted-foreground">Sign in as alice or bob</p>
          </div>

          <div class="space-y-4">
            <div class="space-y-1.5">
              <Label for="username">Username</Label>
              <Input
                id="username"
                v-model="username"
                placeholder="alice"
                autocomplete="username"
                :disabled="loading"
                required
              />
            </div>

            <div class="space-y-1.5">
              <Label for="password">Password</Label>
              <Input
                id="password"
                v-model="password"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
                :disabled="loading"
              />
            </div>
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <Button type="submit" class="w-full" :disabled="loading">
            <LoaderCircle v-if="loading" class="animate-spin" :size="16" />
            {{ loading ? 'Signing in…' : 'Sign in' }}
          </Button>
        </form>
      </Card>
    </div>
  </div>
</template>
