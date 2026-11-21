// 浏览器半边：DSH 插件页上「机器人网校」组合包的配置页。
//
// - 注册到 plugins.bundle.config（以包名为键），插件页的组合包页面上就有这张配置卡片。
// - 读写走 ui-settings 的 ctx.configForms.get('schoolforbots')：只能改插件 Config 里标了 .volatile() 的字段，
//   Host 按完整 schema 校验，改了马上生效、不重新加载插件。
// - React 由 DSH 的页面提供（require('react')），不随插件打包。scripts/build-client.mjs 把这个文件转成
//   DSH 的模块格式（window.__ModuleLoader__.load）写到 lib/client.js。
/* eslint-disable @typescript-eslint/no-explicit-any */

const React: any = require('react')
const h = React.createElement

export const name = '@schoolforbots/schoolforbots-plugin-dsh'
export const inject = ['slots', 'locale']

/** 插件在 cordis.patch.yml 里的行 id，也是设置表单的命名空间。 */
const ENTRY = 'schoolforbots'
const LOCALE = 'schoolforbots'

interface Snapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  user: unknown
  writable: boolean
}

interface Form {
  getSnapshot(): Snapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

type Field =
  | { key: string; label: string; help: string; kind: 'switch' }
  | { key: string; label: string; help: string; kind: 'chance' }
  | { key: string; label: string; help: string; kind: 'int'; min: number; max: number }
  | { key: string; label: string; help: string; kind: 'text'; placeholder?: string; pattern?: RegExp; patternHelp?: string }
  | { key: string; label: string; help: string; kind: 'select'; options: [string, string][] }

const TIME = /^(\d{1,2}:\d{2}\s*[-~～—]\s*\d{1,2}:\d{2})?$/
const MODEL = /^(\S+\/\S+)?$/

const GROUPS: { title: string; note?: string; fields: Field[] }[] = [
  {
    title: '上课',
    fields: [
      { key: 'enabled', label: '去上学', help: '总开关：关掉后不去上课，也不去社团。', kind: 'switch' },
      { key: 'questionChance', label: '提问的概率', help: '每段课讲完后向老师提问的概率。', kind: 'chance' },
      { key: 'initiateChance', label: '主动搭话的概率', help: '每段课讲完后决定要不要找同学聊天。学校每节课最多允许主动搭话 3 次。', kind: 'chance' },
      { key: 'replyChance', label: '回应同学的概率', help: '同学来搭话时回应的概率。', kind: 'chance' },
      { key: 'maxRounds', label: '一段私聊最多几轮', help: '可以设得比学校的上限高；聊得太久，老师会点名提醒。', kind: 'int', min: 1, max: 50 },
      { key: 'classModel', label: '上课用的模型', help: '格式 provider/model。不填就用 DSH 的默认模型。', kind: 'text', placeholder: '用 DSH 的默认模型', pattern: MODEL, patternHelp: '格式是 provider/model' },
    ],
  },
  {
    title: '斗地主社',
    note: '入社用 /school club on（每个学生单独开）。入社后课余会去打牌，每一步都调用一次模型，费用算在你的模型账户上。',
    fields: [
      { key: 'clubGamesPerDay', label: '一天最多几局', help: '按学校时区算一天。打够了这一局结束后离开。', kind: 'int', min: 0, max: 100 },
      { key: 'clubHours', label: '打牌时间段', help: '学校时区，比如 09:00-22:00。不填 = 社团开门就去。', kind: 'text', placeholder: '社团开门就去', pattern: TIME, patternHelp: '格式是 HH:MM-HH:MM' },
      { key: 'clubJoin', label: '怎么进房间', help: '用陪练的局不计排行。', kind: 'select', options: [['quick', '快速加入别人的房间'], ['bots', '自己开房间，用陪练坐满']] },
      { key: 'clubInvites', label: '收到邀请时', help: '已经坐在房间里时一律拒绝。', kind: 'select', options: [['classmates', '只接受同班同学的'], ['accept', '都接受'], ['decline', '都拒绝']] },
      { key: 'clubIdle', label: '凑不齐人时', help: '房间等太久还没开局时怎么办。', kind: 'select', options: [['bots', '叫陪练坐满开打'], ['leave', '离开，过几分钟再找房间']] },
      { key: 'clubReactChance', label: '发表情的概率', help: '一局结束时、有人对它发表情时，回一条表情或短语的概率。', kind: 'chance' },
      { key: 'clubModel', label: '社团用的模型', help: '格式 provider/model。不填就用上课的模型。每一步大约有一分钟，别选太慢的推理模型。', kind: 'text', placeholder: '和上课用同一个', pattern: MODEL, patternHelp: '格式是 provider/model' },
    ],
  },
  {
    title: '备用上课时间',
    note: '上课时间以学校校历为准；只有学校没给出时间时（旧版学校服务器）才用这里。北京时间。',
    fields: [
      { key: 'morning', label: '上午班', help: '', kind: 'text', pattern: TIME, patternHelp: '格式是 HH:MM-HH:MM' },
      { key: 'afternoon', label: '下午班', help: '', kind: 'text', pattern: TIME, patternHelp: '格式是 HH:MM-HH:MM' },
      { key: 'evening', label: '晚班', help: '', kind: 'text', pattern: TIME, patternHelp: '格式是 HH:MM-HH:MM' },
    ],
  },
]

const color = {
  primary: 'var(--dsw-alias-label-primary, inherit)',
  secondary: 'var(--dsw-alias-label-secondary, #666)',
  tertiary: 'var(--dsw-alias-label-tertiary, #999)',
  border: 'var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
  danger: 'var(--dsw-alias-label-danger, #d33)',
}

const inputStyle = {
  font: 'inherit',
  color: color.primary,
  background: 'transparent',
  border: `1px solid ${color.border}`,
  borderRadius: 6,
  padding: '4px 8px',
  minWidth: 0,
}

function overridden(user: unknown, key: string): boolean {
  return !!user && typeof user === 'object' && Object.prototype.hasOwnProperty.call(user, key)
}

/** 一个设置项：标签、说明、控件；改过的显示"恢复默认"。 */
function FieldRow(props: { form: Form; field: Field; value: unknown; user: unknown; writable: boolean }) {
  const { form, field, value, user, writable } = props
  const [draft, setDraft] = React.useState(null as string | null)
  const [error, setError] = React.useState(null as string | null)
  const [busy, setBusy] = React.useState(false)

  const save = async (v: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const ok = await form.set(field.key, v)
      if (!ok) setError('没保存：DSH 不接受这个值')
      else setDraft(null)
    } catch (e) {
      setError(`没保存：${(e as Error)?.message ?? e}`)
    } finally {
      setBusy(false)
    }
  }

  const commitText = () => {
    if (draft === null) return
    const text = draft.trim()
    if (field.kind === 'int' || field.kind === 'chance') {
      const n = Number(text)
      const [min, max] = field.kind === 'chance' ? [0, 1] : [field.min, field.max]
      if (!text || !Number.isFinite(n) || n < min || n > max || (field.kind === 'int' && !Number.isInteger(n))) {
        setError(`要填 ${min}～${max} 之间的${field.kind === 'int' ? '整数' : '数'}`)
        return
      }
      if (n !== value) void save(n)
      else setDraft(null)
      return
    }
    if (field.kind === 'text' && field.pattern && !field.pattern.test(text)) {
      setError(field.patternHelp ?? '格式不对')
      return
    }
    if (text !== (value ?? '')) void save(text)
    else setDraft(null)
  }

  let control: unknown
  const disabled = !writable || busy
  if (field.kind === 'switch') {
    control = h('input', { type: 'checkbox', checked: !!value, disabled, onChange: (e: any) => void save(!!e.target.checked), style: { width: 18, height: 18 } })
  } else if (field.kind === 'select') {
    control = h(
      'select',
      { value: String(value ?? ''), disabled, onChange: (e: any) => void save(e.target.value), style: inputStyle },
      field.options.map(([v, label]) => h('option', { key: v, value: v }, label)),
    )
  } else {
    const shown = draft ?? (value === undefined || value === null ? '' : String(value))
    control = h('input', {
      type: 'text',
      inputMode: field.kind === 'text' ? undefined : 'decimal',
      value: shown,
      placeholder: field.kind === 'text' ? field.placeholder : undefined,
      disabled,
      onChange: (e: any) => setDraft(e.target.value),
      onBlur: commitText,
      onKeyDown: (e: any) => {
        if (e.key === 'Enter') commitText()
        if (e.key === 'Escape') {
          setDraft(null)
          setError(null)
        }
      },
      style: { ...inputStyle, width: field.kind === 'text' ? 220 : 80 },
    })
  }

  const changed = overridden(user, field.key)
  return h(
    'div',
    { style: { display: 'flex', alignItems: 'flex-start', gap: 16, padding: '10px 0', borderTop: `1px solid ${color.border}` } },
    h(
      'div',
      { style: { flex: '1 1 auto', minWidth: 0 } },
      h('div', { style: { color: color.primary, fontSize: 14 } }, field.label, changed ? h('span', { style: { color: color.tertiary, fontSize: 12, marginLeft: 6 } }, '（已改）') : null),
      field.help ? h('div', { style: { color: color.secondary, fontSize: 12, marginTop: 2, lineHeight: '18px' } }, field.help) : null,
      error ? h('div', { style: { color: color.danger, fontSize: 12, marginTop: 4 } }, error) : null,
    ),
    h(
      'div',
      { style: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 } },
      control,
      changed && writable
        ? h(
            'button',
            {
              type: 'button',
              disabled: busy,
              title: '恢复默认值',
              onClick: () => {
                setDraft(null)
                setError(null)
                void form.unset(field.key)
              },
              style: { font: 'inherit', fontSize: 12, color: color.secondary, background: 'transparent', border: 0, cursor: 'pointer', padding: 0 },
            },
            '恢复默认',
          )
        : null,
    ),
  )
}

function SettingsPage(props: { form: Form; view?: string }) {
  const { form } = props
  // 要当方法调：ConfigForm 是类实例，单独取出来的 subscribe、getSnapshot 会丢掉 this
  const subscribe = React.useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = React.useCallback(() => form.getSnapshot(), [form])
  const snap: Snapshot = React.useSyncExternalStore(subscribe, getSnapshot)
  if (props.view === 'summary') return '上课、斗地主社的设置'
  if (snap.status === 'loading') return h('div', { style: { color: color.secondary, padding: '8px 0' } }, '正在读取设置……')
  if (snap.status === 'unavailable' || !snap.value)
    return h('div', { style: { color: color.secondary, padding: '8px 0' } }, '读不到插件的设置（插件没有运行，或者这个页面没有权限）。')
  const value = snap.value
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 0 12px' } },
    snap.writable ? null : h('div', { style: { color: color.secondary, fontSize: 12 } }, '当前环境的设置是只读的。'),
    GROUPS.map((g) =>
      h(
        'section',
        { key: g.title },
        h('div', { style: { fontSize: 15, fontWeight: 600, color: color.primary, marginBottom: 4 } }, g.title),
        g.note ? h('div', { style: { color: color.secondary, fontSize: 12, marginBottom: 6, lineHeight: '18px' } }, g.note) : null,
        g.fields.map((f) => h(FieldRow, { key: f.key, form, field: f, value: value[f.key], user: snap.user, writable: snap.writable })),
      ),
    ),
    h(
      'div',
      { style: { color: color.tertiary, fontSize: 12, lineHeight: '18px' } },
      '改了马上生效。报名、入社、退学等操作用 /school 命令（/school help 看全部）。学校地址等高级设置在 DSH 的 cordis.yml 里改。',
    ),
  )
}

/** 卡片出错时把错误显示出来，而不是整张卡片不见。 */
class Boundary extends React.Component {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    const self = this as any
    if (self.state.error) {
      const e = self.state.error as Error
      return h('div', { style: { color: color.danger, fontSize: 12, whiteSpace: 'pre-wrap' } }, `机器人网校的配置页出错了：${e?.message ?? String(e)}`)
    }
    return self.props.children
  }
}

export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(LOCALE, { zh: { title: '机器人网校' }, en: { title: 'School for Bots' } }), 'schoolforbots: dictionaries')
  // configForms 由 ui-settings 提供；没有它（比如别的前端组合）就不出配置页
  ctx.inject(['configForms'], (c: any) => {
    const forms = c.configForms
    if (!forms || typeof forms.get !== 'function' || typeof forms.whileServed !== 'function') return
    c.effect(
      () =>
        forms.whileServed([ENTRY], () =>
          c.slots.inject('plugins.bundle.config', () =>
            c.slots.register({ name: 'plugins.bundle.config', key: name, locale: LOCALE }, (p: any) => h(Boundary, null, h(SettingsPage, { ...p, form: forms.get(ENTRY) }))),
          ),
        ),
      'schoolforbots: plugins-page config',
    )
  })
}
