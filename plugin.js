/**
 * AgencyOS Ticket Board — Hermes desktop plugin.
 * Sidebar "Tickets" nav row + full board page, backed by the gateway-side
 * Python plugin backend (Firestore via /api/plugins/ticket-board/*).
 *
 * Plain ESM, uncompiled — jsx() calls, not JSX.
 * NOTE: this desktop half loads on the machine running the desktop app.
 */
import {
  host, useValue, Button, EmptyState, ScrollArea,
  ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'ticket-board'
// ctx is passed to register(); captured here so components can call the
// plugin's own backend namespace (/api/plugins/ticket-board/*).
let rest = null

const STATUS_STYLE = {
  BLOCKED: { label: 'Blocked', cls: 'bg-red-500/10 text-red-300' },
  NEW: { label: 'New', cls: 'bg-blue-500/10 text-blue-300' },
  IN_PROGRESS: { label: 'In Progress', cls: 'bg-indigo-500/10 text-indigo-300' },
  WAITING_ON_CARRIER: { label: 'Waiting Carrier', cls: 'bg-purple-500/10 text-purple-300' },
  WAITING_ON_CLIENT: { label: 'Waiting Client', cls: 'bg-pink-500/10 text-pink-300' },
  CLOSED: { label: 'Closed', cls: 'bg-emerald-500/10 text-emerald-300' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-500/10 text-slate-300' },
  OPEN: { label: 'Open', cls: 'bg-amber-500/10 text-amber-300' },
}
const PRIO_STYLE = {
  P0: 'bg-red-600 text-white',
  P1: 'bg-orange-500/80 text-white',
  P2: 'bg-yellow-500/80 text-black',
  P3: 'bg-slate-500/60 text-white',
}

function TicketRow({ t, onOpen }) {
  const st = STATUS_STYLE[t.status] || STATUS_STYLE.OPEN
  const pr = PRIO_STYLE[t.priority]
  const drafts = Object.keys(t.drafts || {}).length
  return jsxs('button', {
    onClick: () => onOpen(t),
    className: 'w-full text-left rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-background) px-3 py-2.5 hover:bg-(--chrome-action-hover) transition-colors mb-1.5',
    children: [
      jsxs('div', { className: 'flex items-center gap-2 mb-0.5', children: [
        t.priority && jsx('span', { className: `text-[10px] font-bold px-1.5 py-0.5 rounded ${pr}`, children: t.priority }),
        jsx('span', { className: 'text-sm font-medium text-(--ui-foreground) truncate flex-1', children: t.clientName || t.subject }),
        jsx('span', { className: `text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`, children: st.label }),
      ]}),
      jsx('div', { className: 'text-xs text-(--ui-text-secondary) truncate', children: t.subject }),
      jsxs('div', { className: 'flex items-center gap-2 mt-1 text-[10px] text-(--ui-text-tertiary)', children: [
        jsx('span', { children: t.channel }),
        t.policyNumber && jsx('span', { className: 'font-mono', children: t.policyNumber }),
        drafts > 0 && jsx('span', { className: 'text-blue-400', children: `✉ ${drafts} draft${drafts > 1 ? 's' : ''}` }),
        t.updatedAt && jsx('span', { className: 'ml-auto', children: new Date(t.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
      ]}),
    ]
  })
}

function BoardPage({ filter, setFilter, onOpen }) {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)

  const load = React.useCallback(() => {
    const q = new URLSearchParams()
    if (filter === 'NEEDS_HUMAN') q.set('needs_human', 'true')
    else if (filter && filter !== 'ALL') q.set('status', filter)
    rest(`/tickets?${q}`)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(String(e)))
  }, [filter])

  React.useEffect(() => { load() }, [load])
  React.useEffect(() => {
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [load])

  if (error) return jsx('div', { className: 'p-4 text-sm text-red-400', children: `Error: ${error}` })
  if (!data) return jsx('div', { className: 'p-4 text-sm text-(--ui-text-secondary)', children: 'Loading tickets…' })

  const tickets = data.tickets || []
  return jsxs('div', { className: 'flex h-full flex-col', children: [
    jsxs('div', { className: 'flex items-center gap-1.5 px-3 py-2 border-b border-(--ui-stroke-secondary)', children: [
      ['NEEDS_HUMAN', 'ALL', 'NEW', 'IN_PROGRESS', 'WAITING_ON_CARRIER', 'WAITING_ON_CLIENT', 'BLOCKED', 'CLOSED'].map(f =>
        jsx('button', {
          key: f,
          onClick: () => setFilter(f),
          className: `px-2 py-1 rounded-md text-xs font-medium transition-colors ${filter === f ? 'bg-(--ui-accent) text-white' : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'}`,
          children: f === 'ALL' ? 'All' : (STATUS_STYLE[f]?.label || f.replace(/_/g, ' ')),
        })
      ),
    ]}),
    jsx('div', { className: 'px-3 py-1.5 border-b border-(--ui-stroke-secondary) text-xs text-(--ui-text-tertiary)', children: `${tickets.length} tickets${filter === 'NEEDS_HUMAN' ? ' — needs your input' : ''}` }),
    tickets.length === 0
      ? jsx('div', { className: 'p-8', children: jsx(EmptyState, { title: 'No tickets', description: 'Nothing in this view right now.' }) })
      : jsxs(ScrollArea, { className: 'flex-1 px-2 py-2', children: tickets.map(t => jsx(TicketRow, { key: t.id, t, onOpen })) }),
  ]})
}

function DetailView({ t, onBack }) {
  const [d, setD] = React.useState(t)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')

  const patch = (body) => {
    setBusy(true)
    rest(`/tickets/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      .then(upd => { setD(upd); setBusy(false) })
      .catch(e => { setMsg(`Error: ${e}`); setBusy(false) })
  }
  const addEvent = (text, type = 'note') => {
    rest(`/tickets/${t.id}/events`, { method: 'POST', body: JSON.stringify({ text, type, visibleToClient: false }) }).catch(() => {})
  }
  const changeStatus = (s) => { patch({ status: s }); addEvent(`Status → ${s}`, 'status') }
  const changePriority = (p) => patch({ priority: p })
  const markDraftQueued = (ch) => {
    const drafts = { ...(d.drafts || {}) }
    if (drafts[ch]) { drafts[ch + ':queued'] = drafts[ch]; delete drafts[ch] }
    patch({ drafts })
    addEvent(`Draft queued for send (${ch})`, 'draft')
  }

  const st = STATUS_STYLE[d.status] || STATUS_STYLE.OPEN
  const planSteps = (d.plan && d.plan.steps) || []
  const msgs = d.messages || []
  const notes = d.privateNotes || []

  return jsxs('div', { className: 'flex h-full flex-col', children: [
    jsxs('div', { className: 'px-4 py-3 border-b border-(--ui-stroke-secondary)', children: [
      jsx('button', { onClick: onBack, className: 'text-xs text-(--ui-text-secondary) hover:text-(--ui-foreground) mb-2', children: '← Back' }),
      jsxs('div', { className: 'flex items-center gap-2', children: [
        d.priority && jsx('span', { className: `text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIO_STYLE[d.priority]}`, children: d.priority }),
        jsx('h2', { className: 'text-base font-semibold text-(--ui-foreground) flex-1', children: d.clientName || d.subject }),
        jsx('span', { className: `text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`, children: st.label }),
      ]}),
      jsx('div', { className: 'text-xs text-(--ui-text-secondary) mt-0.5', children: d.subject }),
      d.policyNumber && jsx('div', { className: 'text-[11px] font-mono text-(--ui-text-tertiary) mt-1', children: `Policy ${d.policyNumber}${d.carrier ? ` · ${d.carrier}` : ''}` }),
    ]}),

    jsxs(ScrollArea, { className: 'flex-1 px-4 py-3 space-y-4', children: [
      jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
        jsx('span', { className: 'text-[10px] font-bold uppercase text-(--ui-text-tertiary) mr-1', children: 'Status' }),
        ['NEW', 'IN_PROGRESS', 'WAITING_ON_CARRIER', 'WAITING_ON_CLIENT', 'BLOCKED', 'CLOSED'].map(s =>
          jsx('button', { key: s, onClick: () => changeStatus(s), disabled: busy,
            className: `px-2 py-1 rounded-md text-[10px] font-semibold ${d.status === s ? 'bg-(--ui-accent) text-white' : 'bg-(--chrome-action-hover) text-(--ui-text-secondary)'}`,
            children: STATUS_STYLE[s]?.label || s })),
      ]}),
      jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
        jsx('span', { className: 'text-[10px] font-bold uppercase text-(--ui-text-tertiary) mr-1', children: 'Priority' }),
        ['P0', 'P1', 'P2', 'P3'].map(p =>
          jsx('button', { key: p, onClick: () => changePriority(p), disabled: busy,
            className: `px-2 py-1 rounded-md text-[10px] font-bold ${d.priority === p ? 'bg-(--ui-accent) text-white' : 'bg-(--chrome-action-hover) text-(--ui-text-secondary)'}`,
            children: p })),
      ]}),

      jsxs('div', { children: [
        jsx('h3', { className: 'text-[11px] font-bold uppercase text-(--ui-text-tertiary) mb-1.5', children: 'Messages' }),
        msgs.length === 0 ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary) italic', children: 'No messages attached.' })
          : msgs.map((m, i) => jsxs('div', { key: i, className: 'rounded-lg border border-(--ui-stroke-secondary) px-3 py-2 mb-1.5 text-xs', children: [
            jsxs('div', { className: 'flex justify-between text-[10px] text-(--ui-text-tertiary) mb-1', children: [
              jsx('span', { className: 'font-semibold', children: m.senderName || m.channel }),
              m.timestamp && jsx('span', { children: new Date(m.timestamp).toLocaleString() }),
            ]}),
            jsx('div', { className: 'whitespace-pre-wrap text-(--ui-foreground)', children: m.content?.slice(0, 800) }),
          ]})),
      ]}),

      jsxs('div', { children: [
        jsx('h3', { className: 'text-[11px] font-bold uppercase text-(--ui-text-tertiary) mb-1.5', children: 'Plan & Tasks' }),
        planSteps.length === 0 ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary) italic', children: 'No plan yet.' })
          : planSteps.map((s, i) => jsxs('div', { key: i, className: 'flex items-start gap-2 rounded-lg border border-(--ui-stroke-secondary) px-3 py-2 mb-1.5 text-xs', children: [
            jsx('span', { className: `mt-0.5 ${s.assigneeType === 'AI' ? 'text-blue-400' : 'text-amber-400'}`, children: s.assigneeType === 'AI' ? '⚡' : '👤' }),
            jsxs('div', { className: 'flex-1', children: [
              jsx('div', { className: 'text-(--ui-foreground) font-medium', children: s.title }),
              s.scheduledStart && jsx('div', { className: 'text-[10px] text-(--ui-text-tertiary)', children: `📅 ${new Date(s.scheduledStart).toLocaleString()}` }),
            ]}),
            s.estimatedMinutes && jsx('span', { className: 'text-[10px] text-(--ui-text-tertiary)', children: `${s.estimatedMinutes}m` }),
          ]})),
      ]}),

      jsxs('div', { children: [
        jsx('h3', { className: 'text-[11px] font-bold uppercase text-(--ui-text-tertiary) mb-1.5', children: 'Drafts' }),
        Object.keys(d.drafts || {}).length === 0 ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary) italic', children: 'No drafts.' })
          : Object.entries(d.drafts || {}).map(([ch, text]) =>
            jsxs('div', { key: ch, className: 'rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 mb-1.5 text-xs', children: [
              jsxs('div', { className: 'flex justify-between items-center mb-1', children: [
                jsx('span', { className: 'text-[10px] font-bold text-blue-300', children: ch }),
                jsx(Button, { size: 'sm', variant: 'primary', onClick: () => markDraftQueued(ch), children: 'Approve → queue' }),
              ]}),
              jsx('div', { className: 'whitespace-pre-wrap text-(--ui-foreground) max-h-32 overflow-y-auto', children: text }),
            ])),
      ]}),

      (d.actionItems?.length || d.aiTasks?.length) && jsxs('div', { children: [
        jsx('h3', { className: 'text-[11px] font-bold uppercase text-(--ui-text-tertiary) mb-1.5', children: 'What needs doing' }),
        (d.actionItems || []).map((a, i) => jsx('div', { key: `a${i}`, className: 'flex items-start gap-2 text-xs text-amber-200 mb-1', children: ['🔴', jsx('span', { children: a })] })),
        (d.aiTasks || []).map((a, i) => jsx('div', { key: `i${i}`, className: 'flex items-start gap-2 text-xs text-blue-200 mb-1', children: ['⚡', jsx('span', { children: a })] })),
      ]}),

      notes.length > 0 && jsxs('div', { children: [
        jsx('h3', { className: 'text-[11px] font-bold uppercase text-(--ui-text-tertiary) mb-1.5', children: 'Notes' }),
        notes.map((n, i) => jsx('div', { key: i, className: 'text-xs text-(--ui-text-secondary) mb-1', children: `• ${n.text}` })),
      ]}),

      msg && jsx('div', { className: 'text-xs text-red-400', children: msg }),
    ]}),
  ]})
}

function TicketApp() {
  const [filter, setFilter] = React.useState('NEEDS_HUMAN')
  const [open, setOpen] = React.useState(null)
  if (open) return jsx(DetailView, { t: open, onBack: () => setOpen(null) })
  return jsx(BoardPage, { filter, setFilter, onOpen: setOpen })
}

export default {
  id: ID,
  name: 'Ticket Board',
  register(ctx) {
    rest = ctx.rest
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/tickets' },
        render: () => jsx(TicketApp, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 40,
        data: { path: '/tickets', label: 'Tickets', codicon: 'inbox' },
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'ticket-board.open',
          label: 'Open Ticket Board',
          keywords: ['tickets', 'board', 'queue'],
          run: () => host.navigate('/tickets'),
        },
      },
    ])
  },
}
