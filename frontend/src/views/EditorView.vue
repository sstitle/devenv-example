<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import { EditorView as CMEditorView, ViewPlugin, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { createHighlighter, bundledLanguagesInfo, type Highlighter } from 'shiki'
import { LogOut, ChevronDown } from 'lucide-vue-next'
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

// Language picker state
const lang = ref('markdown')
const langSearch = ref('')
const langPickerOpen = ref(false)
const langPickerRef = ref<HTMLDivElement | null>(null)
let highlighterInstance: Highlighter | null = null

const filteredLangs = computed(() => {
  const q = langSearch.value.toLowerCase()
  if (!q) return bundledLanguagesInfo
  return bundledLanguagesInfo.filter(
    (l) =>
      l.id.toLowerCase().includes(q) ||
      l.name.toLowerCase().includes(q) ||
      (l.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
  )
})

async function selectLang(id: string) {
  if (!highlighterInstance) return
  if (!highlighterInstance.getLoadedLanguages().includes(id)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await highlighterInstance.loadLanguage(id as any)
  }
  lang.value = id
  langPickerOpen.value = false
  langSearch.value = ''
  // Dispatch an empty transaction so the ViewPlugin sees lang changed and re-highlights
  cmView?.dispatch({})
}

function handleOutsideClick(e: MouseEvent) {
  if (langPickerRef.value && !langPickerRef.value.contains(e.target as Node)) {
    langPickerOpen.value = false
  }
}

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

onMounted(async () => {
  document.addEventListener('click', handleOutsideClick)

  const highlighter = await createHighlighter({
    themes: ['monokai'],
    langs: ['markdown'],
  })
  highlighterInstance = highlighter

  const { bg, fg } = highlighter.getTheme('monokai')

  function highlight(view: CMEditorView, h: Highlighter): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>()
    const firstLine = view.state.doc.lineAt(view.viewport.from)
    const lastLine = view.state.doc.lineAt(view.viewport.to)
    const text = view.state.doc.sliceString(firstLine.from, lastLine.to)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { tokens } = h.codeToTokens(text, { lang: lang.value as any, theme: 'monokai' })
    const base = firstLine.from
    for (const lineTokens of tokens) {
      for (const token of lineTokens ?? []) {
        if (token.color) {
          builder.add(
            base + token.offset,
            base + token.offset + token.content.length,
            Decoration.mark({ attributes: { style: `color: ${token.color}` } }),
          )
        }
      }
    }
    return builder.finish()
  }

  function buildShikiPlugin(h: Highlighter) {
    let lastLang = lang.value
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: CMEditorView) {
          this.decorations = highlight(view, h)
        }
        update(update: { docChanged: boolean; viewportChanged: boolean; view: CMEditorView }) {
          const currentLang = lang.value
          if (update.docChanged || update.viewportChanged || currentLang !== lastLang) {
            lastLang = currentLang
            this.decorations = highlight(update.view, h)
          }
        }
      },
      { decorations: (v) => v.decorations },
    )
  }

  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      markdown(),
      buildShikiPlugin(highlighter),
      // Binds Y.Text to the editor state and renders remote cursors + selections inline
      yCollab(ytext, provider.awareness, { undoManager }),
      CMEditorView.theme(
        {
          '&': { height: '100%', background: bg },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: '14px',
            lineHeight: '1.7',
          },
          '.cm-gutters': { background: bg, borderColor: bg, color: '#75715e' },
          '.cm-content': { padding: '16px 0', color: fg, caretColor: fg },
          '.cm-line': { padding: '0 20px' },
          '.cm-activeLine': { background: '#3e3d3280' },
          '.cm-activeLineGutter': { background: '#3e3d3280' },
          '.cm-selectionBackground, .cm-focused .cm-selectionBackground': {
            background: '#49483e',
          },
        },
        { dark: true },
      ),
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
  document.removeEventListener('click', handleOutsideClick)
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

      <!-- Language picker -->
      <div ref="langPickerRef" class="relative" @click.stop>
        <button
          class="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-md border bg-muted/50 hover:bg-muted transition-colors"
          @click="langPickerOpen = !langPickerOpen"
        >
          {{ lang }}
          <ChevronDown :size="12" class="text-muted-foreground" :class="{ 'rotate-180': langPickerOpen }" />
        </button>

        <div
          v-if="langPickerOpen"
          class="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-56 z-50 rounded-md border bg-popover shadow-md overflow-hidden"
        >
          <div class="p-1.5 border-b">
            <input
              v-model="langSearch"
              placeholder="Search languages…"
              class="w-full text-xs px-2 py-1.5 rounded bg-muted/50 outline-none placeholder:text-muted-foreground"
              autofocus
              @click.stop
            />
          </div>
          <div class="overflow-y-auto max-h-64">
            <button
              v-for="l in filteredLangs"
              :key="l.id"
              class="w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center justify-between"
              :class="{ 'text-primary font-medium': l.id === lang }"
              @click="selectLang(l.id)"
            >
              <span>{{ l.name }}</span>
              <span class="text-muted-foreground font-mono">{{ l.id }}</span>
            </button>
            <div v-if="filteredLangs.length === 0" class="text-xs text-muted-foreground px-3 py-3 text-center">
              No languages found
            </div>
          </div>
        </div>
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
