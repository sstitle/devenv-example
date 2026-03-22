<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import {
  yCollab,
  yRemoteSelections,
  yRemoteSelectionsTheme,
} from 'y-codemirror.next'
import {
  EditorView as CMEditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { EditorState, StateEffect, RangeSetBuilder, Annotation, type Range, type Extension } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { createHighlighter, bundledLanguagesInfo, type Highlighter } from 'shiki'
import { cva } from 'class-variance-authority'
import { LogOut, ChevronDown } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

// ---------------------------------------------------------------------------
// Peer selection CVA variants
// Defines the class API for ego-context vs peer-context selection marks.
// The actual colors come from --peer-color CSS custom property set per-mark.
// ---------------------------------------------------------------------------
const peerSelectionVariants = cva('cm-peer-selection', {
  variants: {
    span: {
      inline: 'cm-peer-selection--inline',
      block: 'cm-peer-selection--block',
    },
  },
})

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface UserIdentity {
  name: string
  color: string
}

interface AwarenessState {
  name: string
  color: string
}

// Raw shape coming off the wire from y-codemirror.next awareness
interface RawAwarenessState {
  user?: { name?: string; color?: string }
  cursor?: unknown
}

// ---------------------------------------------------------------------------
// Router / editor refs
// ---------------------------------------------------------------------------
const router = useRouter()
const editorContainer = ref<HTMLDivElement | null>(null)
const connStatus = ref<'connecting' | 'connected' | 'disconnected'>('connecting')
const peers = ref<AwarenessState[]>([])

// Signals a language change into the CM6 plugin system so the Shiki plugin
// can reliably re-render without depending on a fragile lastLang closure variable.
const langChangeEffect = StateEffect.define<string>()

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
  ymeta.set('lang', id)
  langPickerOpen.value = false
  langSearch.value = ''
  cmView?.dispatch({ effects: langChangeEffect.of(id) })
}

function handleOutsideClick(e: MouseEvent) {
  if (langPickerRef.value && !langPickerRef.value.contains(e.target as Node)) {
    langPickerOpen.value = false
  }
}

// ---------------------------------------------------------------------------
// Yjs setup
// ---------------------------------------------------------------------------
const raw = localStorage.getItem('user')
const user: UserIdentity = raw ? JSON.parse(raw) : { name: 'unknown', color: '#888' }

const doc = new Y.Doc()
const ytext = doc.getText('content')
const ymeta = doc.getMap<string>('meta')
const undoManager = new Y.UndoManager(ytext)
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const provider = new WebsocketProvider(`${wsProtocol}//${location.host}/ws`, 'demo-room', doc)

// Standard y-codemirror.next convention: user identity lives under the 'user' field.
// setLocalStateField merges into the existing state so ySync's 'cursor' field is preserved.
provider.awareness.setLocalStateField('user', { name: user.name, color: user.color })

provider.on('status', ({ status }: { status: string }) => {
  console.debug('[yjs:provider] status →', status)
  connStatus.value = status as typeof connStatus.value
})

// Rebuilds the peers list from the current awareness snapshot.
// Deduplicates by name to handle the case where a peer's old clientID lingers
// in the awareness map during the window between a drop and the server's cleanup.
function refreshPeers() {
  const rawStates = Object.fromEntries(provider.awareness.getStates())
  console.debug('[yjs:presence] refreshPeers — raw awareness states', rawStates)
  const seen = new Set<string>()
  peers.value = [...provider.awareness.getStates().entries()]
    .filter(([id]) => id !== provider.awareness.clientID)
    .map(([, state]) => (state as RawAwarenessState).user)
    .filter((u): u is { name: string; color: string } => {
      if (!u?.name || seen.has(u.name)) return false
      seen.add(u.name)
      return true
    })
  console.debug('[yjs:presence] peers after refresh', peers.value)
}

// 'change' covers ongoing presence updates; 'sync' covers the initial load where
// awareness state from existing peers arrives as part of the first sync batch.
provider.awareness.on(
  'change',
  ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    console.debug('[yjs:awareness] change event', { added, updated, removed })
    refreshPeers()
  },
)
provider.on('sync', (isSynced: boolean) => {
  console.debug('[yjs:provider] sync isSynced=', isSynced)
  if (isSynced) refreshPeers()
})

// Seed local state from CRDT (handles late-joining peers)
const _initialLang = ymeta.get('lang')
if (_initialLang) lang.value = _initialLang

// Observe CRDT language changes from peers.
// lang.value is set only after the language is loaded in Shiki to prevent the
// race where highlight() would throw (unknown language) before apply() fires,
// causing lastLang to advance and the final dispatch to be a no-op.
ymeta.observe(() => {
  const newLang = ymeta.get('lang')
  if (!newLang || newLang === lang.value) return
  const applyLang = () => {
    lang.value = newLang
    cmView?.dispatch({ effects: langChangeEffect.of(newLang) })
  }
  if (highlighterInstance) {
    if (!highlighterInstance.getLoadedLanguages().includes(newLang)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      highlighterInstance.loadLanguage(newLang as any).then(applyLang)
    } else {
      applyLang()
    }
  } else {
    // Highlighter not ready yet; onMounted will pick up lang.value on init
    lang.value = newLang
  }
})

let cmView: CMEditorView | null = null

// ---------------------------------------------------------------------------
// Peer cursor widget — renders the blinking caret + hover name tooltip.
// Sets --peer-color on the root element so the child .cm-ySelectionInfo can
// use it for auto-contrasting text via oklch relative color syntax.
// ---------------------------------------------------------------------------
class PeerCursorWidget extends WidgetType {
  constructor(
    private color: string,
    private name: string,
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const caret = document.createElement('span')
    caret.className = 'cm-ySelectionCaret'
    // Set --peer-color here so .cm-ySelectionInfo can inherit it
    caret.style.cssText = `background-color:${this.color};border-color:${this.color};--peer-color:${this.color}`

    const dot = document.createElement('div')
    dot.className = 'cm-ySelectionCaretDot'

    const info = document.createElement('div')
    info.className = 'cm-ySelectionInfo'
    info.textContent = this.name

    caret.append('\u2060', dot, '\u2060', info, '\u2060')
    return caret
  }

  eq(other: PeerCursorWidget): boolean {
    return other.color === this.color && other.name === this.name
  }

  get estimatedHeight() {
    return -1
  }
  ignoreEvent() {
    return true
  }
}

// ---------------------------------------------------------------------------
// Custom peer selections plugin — full replacement for yRemoteSelections.
// yRemoteSelections does two things: (1) writes our cursor to awareness on
// every view update, (2) renders remote cursors/selections as decorations.
// We need both here — omitting the cursor-write is why peers never saw a
// cursor field in awareness despite the plugin otherwise working.
// ---------------------------------------------------------------------------
function buildPeerSelectionsPlugin(
  ytextRef: Y.Text,
  awareness: typeof provider.awareness,
): Extension {
  const peerAnnotation = Annotation.define<null>()

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private listener: (...args: any[]) => void

      constructor(view: CMEditorView) {
        this.decorations = Decoration.none
        this.listener = ({
          added,
          updated,
          removed,
        }: {
          added: number[]
          updated: number[]
          removed: number[]
        }) => {
          // Only redecorate for remote changes. Our own cursor write inside
          // update() fires this listener synchronously — dispatching here would
          // crash CM with "update not allowed while update is in progress".
          const hasRemote = [...added, ...updated, ...removed].some(
            (id) => id !== awareness.clientID,
          )
          console.log('[yjs:selection] awareness change → redecorate', { added, updated, removed, hasRemote })
          if (hasRemote) {
            view.dispatch({ annotations: [peerAnnotation.of(null)] })
          }
        }
        awareness.on('change', this.listener)
        this.decorations = buildDecorations(view)
      }

      destroy() {
        awareness.off('change', this.listener)
      }

      update(update: ViewUpdate) {
        // Broadcast our own cursor — mirrors YRemoteSelectionsPluginValue.update()
        // which we removed by filtering yRemoteSelections out of yCollab.
        const localState = awareness.getLocalState()
        if (localState != null) {
          const hasFocus = update.view.hasFocus && update.view.dom.ownerDocument.hasFocus()
          const sel = hasFocus ? update.state.selection.main : null
          if (sel != null) {
            const anchor = Y.createRelativePositionFromTypeIndex(ytextRef, sel.anchor)
            const head = Y.createRelativePositionFromTypeIndex(ytextRef, sel.head)
            const curAnchor =
              localState.cursor == null
                ? null
                : Y.createRelativePositionFromJSON(localState.cursor.anchor)
            const curHead =
              localState.cursor == null
                ? null
                : Y.createRelativePositionFromJSON(localState.cursor.head)
            if (
              localState.cursor == null ||
              !Y.compareRelativePositions(curAnchor, anchor) ||
              !Y.compareRelativePositions(curHead, head)
            ) {
              awareness.setLocalStateField('cursor', { anchor, head })
            }
          } else if (localState.cursor != null && hasFocus) {
            awareness.setLocalStateField('cursor', null)
          }
        }

        const hasPeerChange = update.transactions.some(
          (tr) => tr.annotation(peerAnnotation) !== undefined,
        )
        if (update.docChanged || hasPeerChange) {
          this.decorations = buildDecorations(update.view)
        }
      }
    },
    { decorations: (v) => v.decorations },
  )

  function buildDecorations(view: CMEditorView): DecorationSet {
    const ydoc = ytextRef.doc!
    const ranges: Range<Decoration>[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    awareness.getStates().forEach((state: any, clientId: number) => {
      if (clientId === awareness.clientID) return

      console.debug('[yjs:selection] client', clientId, 'raw state', JSON.parse(JSON.stringify(state)))

      const cursor = state.cursor
      if (!cursor?.anchor || !cursor?.head) {
        console.debug('[yjs:selection] client', clientId, '→ skip: no cursor field')
        return
      }

      const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ydoc)
      const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!anchor || !head || (anchor as any).type !== ytextRef || (head as any).type !== ytextRef) {
        console.debug('[yjs:selection] client', clientId, '→ skip: position resolution failed', { anchor, head })
        return
      }

      const userInfo = (state as RawAwarenessState).user
      const color = userInfo?.color ?? '#30bced'
      const name = userInfo?.name ?? 'Anonymous'
      console.debug('[yjs:selection] client', clientId, `"${name}" cursor anchor=${anchor.index} head=${head.index}`)
      const colorStyle = `--peer-color:${color}`

      const start = Math.min(anchor.index, head.index)
      const end = Math.max(anchor.index, head.index)

      if (start !== end) {
        const startLine = view.state.doc.lineAt(start)
        const endLine = view.state.doc.lineAt(end)

        if (startLine.number === endLine.number) {
          ranges.push(
            Decoration.mark({
              class: peerSelectionVariants({ span: 'inline' }),
              attributes: { style: colorStyle },
            }).range(start, end),
          )
        } else {
          if (start < startLine.to) {
            ranges.push(
              Decoration.mark({
                class: peerSelectionVariants({ span: 'inline' }),
                attributes: { style: colorStyle },
              }).range(start, startLine.to),
            )
          }
          for (let i = startLine.number + 1; i < endLine.number; i++) {
            const lineFrom = view.state.doc.line(i).from
            ranges.push(
              Decoration.line({
                attributes: {
                  class: peerSelectionVariants({ span: 'block' }),
                  style: colorStyle,
                },
              }).range(lineFrom),
            )
          }
          if (endLine.from < end) {
            ranges.push(
              Decoration.mark({
                class: peerSelectionVariants({ span: 'inline' }),
                attributes: { style: colorStyle },
              }).range(endLine.from, end),
            )
          }
        }
      }

      // Cursor widget
      ranges.push(
        Decoration.widget({
          side: head.index - anchor.index > 0 ? -1 : 1,
          block: false,
          widget: new PeerCursorWidget(color, name),
        }).range(head.index),
      )
    })

    ranges.sort((a, b) => a.from - b.from || (a.to ?? a.from) - (b.to ?? b.from))
    return Decoration.set(ranges, true)
  }
}

// ---------------------------------------------------------------------------
// Editor mount
// ---------------------------------------------------------------------------
onMounted(async () => {
  document.addEventListener('click', handleOutsideClick)

  const highlighter = await createHighlighter({
    themes: ['monokai'],
    langs: ['markdown'],
  })
  highlighterInstance = highlighter

  // Load CRDT language if a peer has already set one
  if (lang.value !== 'markdown' && !highlighter.getLoadedLanguages().includes(lang.value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await highlighter.loadLanguage(lang.value as any)
  }

  const { bg, fg } = highlighter.getTheme('monokai')

  // Shiki syntax highlighting plugin
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
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: CMEditorView) {
          this.decorations = highlight(view, h)
        }
        update(update: ViewUpdate) {
          const hasLangChange = update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(langChangeEffect)),
          )
          if (update.docChanged || update.viewportChanged || hasLangChange) {
            this.decorations = highlight(update.view, h)
          }
        }
      },
      { decorations: (v) => v.decorations },
    )
  }

  // Strip yRemoteSelections AND yRemoteSelectionsTheme from yCollab — we
  // replace the plugin with our own and define all cursor/selection CSS ourselves
  const collabExtensions = (
    yCollab(ytext, provider.awareness, { undoManager }) as Extension[]
  ).filter((ext) => ext !== yRemoteSelections && ext !== yRemoteSelectionsTheme)

  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      markdown(),
      buildShikiPlugin(highlighter),
      ...collabExtensions,
      buildPeerSelectionsPlugin(ytext, provider.awareness),
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
          '.cm-content': { padding: '16px 0', color: fg, caretColor: 'transparent' },
          '.cm-cursor, .cm-dropCursor': { display: 'none' },
          '.cm-line': { padding: '0 20px' },

          // Ego selection — blue tint at higher opacity for visibility on dark bg
          '.cm-selectionBackground, .cm-focused .cm-selectionBackground': {
            background: 'rgba(100,153,255,0.35)',
          },

          '.cm-activeLine': { background: '#3e3d3280' },
          '.cm-activeLineGutter': { background: '#3e3d3280' },

          // Peer selection mark — --peer-color is set as an inline custom property
          // on each mark element by the plugin
          '.cm-peer-selection--inline': {
            backgroundColor: 'color-mix(in oklch, var(--peer-color) 55%, transparent)',
          },
          '.cm-peer-selection--block': {
            backgroundColor: 'color-mix(in oklch, var(--peer-color) 40%, transparent)',
          },

          // Peer cursor caret — 2px wide, colored from --peer-color set on the element
          '.cm-ySelectionCaret': {
            position: 'relative',
            borderLeft: '2px solid var(--peer-color)',
            borderRight: 'none',
            marginLeft: '-1px',
            marginRight: '0',
            boxSizing: 'border-box',
            display: 'inline',
          },
          '.cm-ySelectionCaretDot': {
            borderRadius: '50%',
            position: 'absolute',
            width: '6px',
            height: '6px',
            top: '-4px',
            left: '-4px',
            backgroundColor: 'var(--peer-color)',
            transition: 'transform .3s ease-in-out',
            boxSizing: 'border-box',
          },
          '.cm-ySelectionCaret:hover .cm-ySelectionCaretDot': {
            transform: 'scale(0)',
          },

          // Name tooltip — auto-contrasting text via CSS oklch relative color:
          //   peer color lightness < 0.5 → (0.5−l)×∞ clamps to 1 → white text
          //   peer color lightness ≥ 0.5 → (0.5−l)×∞ clamps to 0 → black text
          '.cm-ySelectionInfo': {
            position: 'absolute',
            top: '-1.4em',
            left: '-1px',
            fontSize: '0.7em',
            fontFamily: 'sans-serif',
            fontStyle: 'normal',
            fontWeight: '600',
            lineHeight: 'normal',
            userSelect: 'none',
            paddingLeft: '4px',
            paddingRight: '4px',
            paddingTop: '1px',
            paddingBottom: '1px',
            borderRadius: '3px',
            zIndex: '101',
            whiteSpace: 'nowrap',
            backgroundColor: 'var(--peer-color)',
            color: 'oklch(from var(--peer-color) calc((0.5 - l) * infinity) 0 0)',
            opacity: '0',
            transition: 'opacity .15s ease-in-out',
          },
          '.cm-ySelectionCaret:hover .cm-ySelectionInfo': {
            opacity: '1',
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
          <ChevronDown
            :size="12"
            class="text-muted-foreground"
            :class="{ 'rotate-180': langPickerOpen }"
          />
        </button>

        <div
          v-if="langPickerOpen"
          class="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-56 z-50 rounded-md border bg-card shadow-md overflow-hidden"
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
            <div
              v-if="filteredLangs.length === 0"
              class="text-xs text-muted-foreground px-3 py-3 text-center"
            >
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
