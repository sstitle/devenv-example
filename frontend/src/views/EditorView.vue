<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import { EditorView as CMEditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { monokai } from '@uiw/codemirror-theme-monokai'
import { LogOut } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

interface UserIdentity {
  name: string
  color: string
}

interface AwarenessState {
  name: string
  color: string
}

const router = useRouter()
const editorContainer = ref<HTMLDivElement | null>(null)
const connStatus = ref<'connecting' | 'connected' | 'disconnected'>('connecting')
const peers = ref<AwarenessState[]>([])

const raw = localStorage.getItem('user')
const user: UserIdentity = raw ? JSON.parse(raw) : { name: 'unknown', color: '#888' }

const doc = new Y.Doc()
const ytext = doc.getText('content')
const undoManager = new Y.UndoManager(ytext)
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const provider = new WebsocketProvider(`${wsProtocol}//${location.host}/ws`, 'demo-room', doc)

// y-codemirror.next reads name + color from awareness to render remote cursors/selections
provider.awareness.setLocalState({ name: user.name, color: user.color })

provider.on('status', ({ status }: { status: string }) => {
  connStatus.value = status as typeof connStatus.value
})

provider.awareness.on('change', () => {
  peers.value = [...provider.awareness.getStates().entries()]
    .filter(([id]) => id !== provider.awareness.clientID)
    .map(([, state]) => state as AwarenessState)
    .filter((s) => s?.name)
})

let cmView: CMEditorView | null = null

onMounted(() => {
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      markdown(),
      monokai,
      // Binds Y.Text to the editor state and renders remote cursors + selections inline
      yCollab(ytext, provider.awareness, { undoManager }),
      CMEditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: '14px',
          lineHeight: '1.7',
        },
        '.cm-content': { padding: '16px 0' },
        '.cm-line': { padding: '0 20px' },
      }),
    ],
  })

  cmView = new CMEditorView({ state, parent: editorContainer.value! })
  cmView.focus()
})

function logout() {
  cmView?.destroy()
  provider.destroy()
  doc.destroy()
  localStorage.removeItem('user')
  router.push('/')
}

onUnmounted(() => {
  cmView?.destroy()
  provider.destroy()
  doc.destroy()
})
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background">
    <header class="flex items-center justify-between border-b px-4 py-2.5 shrink-0">
      <div class="flex items-center gap-2.5">
        <div class="h-2.5 w-2.5 rounded-full" :style="{ background: user.color }" />
        <span class="text-sm font-medium">{{ user.name }}</span>
        <span
          class="text-xs px-1.5 py-0.5 rounded-full"
          :class="{
            'bg-green-100 text-green-700': connStatus === 'connected',
            'bg-yellow-100 text-yellow-700': connStatus === 'connecting',
            'bg-red-100 text-red-700': connStatus === 'disconnected',
          }"
        >
          {{ connStatus }}
        </span>
      </div>

      <div class="flex items-center gap-3">
        <template v-for="peer in peers" :key="peer.name">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div class="h-2 w-2 rounded-full animate-pulse" :style="{ background: peer.color }" />
            <span>{{ peer.name }}</span>
          </div>
        </template>
      </div>

      <Button variant="ghost" size="sm" class="gap-1.5 text-muted-foreground" @click="logout">
        <LogOut :size="14" />
        Sign out
      </Button>
    </header>

    <!-- CodeMirror mounts here and fills all remaining height -->
    <div ref="editorContainer" class="flex-1 min-h-0 overflow-hidden" />
  </div>
</template>
