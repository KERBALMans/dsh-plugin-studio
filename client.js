/**
 * Client half of 插件工坊 (dsh-plugin-studio).
 *
 * One settings page that does for plugins and skills what a package manager
 * does for software: show what is installed, group it so a human can find
 * things, say what each item actually does, show when it was last touched, and
 * let you tick boxes and remove things.
 *
 * ## Why it is built this way
 *
 * - **Everything is drawn from `rows`.** The Host also sends a `tree`, but the
 *   page groups rows itself so search and the filter chips can hide a whole
 *   branch without a round trip. The tree shape and the row fields agree by
 *   construction because both come from the same Host pass.
 * - **No Harness imports.** The module loader hands us `react` and nothing
 *   else, so every control here is built from `div`/`button`/`input` and the
 *   `--dsw-alias-*` custom properties. Nothing is appended to `document.body`
 *   and nothing reads another plugin's DOM; the only global write is a `<style>`
 *   element in `<head>`, registered through `ctx.effect` so it is removed with
 *   the plugin.
 * - **Destructive actions are two-step.** A checkbox selection is not a
 *   deletion; the delete button opens a confirmation that lists exactly what
 *   will go, and the restart notice appears *after* the Host reports that one
 *   is needed — never as a guess beforehand.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/api/dsh-plugin-studio'
    const API_VERSION = 3

    /* -------------------------------------------------------------- */
    /* text                                                            */
    /* -------------------------------------------------------------- */

    const DICT = {
      zh: {
        title: '插件工坊',
        subtitle: '一个页面管好插件和技能：自动三级分类、批量删除、大白话讲解、最后使用时间、一键打包。',
        tabPlugins: '插件',
        tabSkills: '技能',
        tabPacks: '整合包',
        refresh: '刷新',
        search: '搜索名称、描述或分类…',
        filterAll: '全部',
        filterEnabled: '已启用',
        filterUnused: '90 天未用',
        filterRemovable: '可删除',
        filterUnknown: '低置信度',
        viewTree: '分类视图',
        viewList: '列表视图',
        expandAll: '展开全部',
        collapseAll: '收起全部',
        selected: '已选 {n} 项',
        clear: '取消选择',
        remove: '删除',
        explain: 'AI 讲解',
        pack: '打包',
        enable: '启用',
        disable: '停用',
        selectAll: '全选本组',
        empty: '这里还没有东西。',
        emptyFilter: '没有符合筛选条件的条目。',
        loading: '正在读取…',
        error: '出错了',
        retry: '重试',
        neverUsed: '从没用过',
        lastUsed: '最后使用：',
        official: '官方',
        locked: '不可删',
        disabled: '已停用',
        lowConf: '低置信度',
        unregistered: '未注册',
        evidence: '判断依据',
        what: '它是干什么的',
        removeEffect: '删了会怎样',
        why: '为什么这么判断',
        noExplain: '还没有讲解。点「AI 讲解」让它读代码和说明后告诉你。',
        explainRunning: '正在读代码和说明…',
        explainDone: '讲解完成：{n} 条',
        explainPartial: '模型只讲解了 {found}/{asked} 条，其余可再点一次补上。',
        removeTitle: '确认删除',
        removeBody: '下面这些会被真正移除，不是隐藏也不是停用。',
        removeSkillsBody: '下面这些技能目录会被删除。技能目录删掉就找不回来了，请确认。',
        cancel: '取消',
        confirmRemove: '确认删除',
        removing: '正在删除…',
        restartTitle: '需要重启客户端',
        restartBody: '改动已经写入，但要让客户端重新加载，请手动退出并重新打开 DeepSeek Harness。',
        knowIt: '知道了',
        removedOk: '已删除 {n} 项',
        removedFail: '{n} 项没删掉',
        packTitle: '打包',
        packName: '整合包名称',
        packSave: '保存到本机',
        packDownload: '下载文件',
        packDone: '已保存：{file}',
        packsEmpty: '还没有保存过整合包。勾选条目后点「打包」。',
        packsDelete: '删除',
        usageSource: '使用记录来自 {source}',
        usageNone: '本机还没有会话记录',
        aiStats: '模型 {model} 读了 {asked} 条，回来 {found} 条',
        aiOff: 'AI 不可用：{reason}',
        warnings: '提示',
        family: '一级分类',
        domain: '二级分类',
        rows: '{n} 个插件',
        skillsRows: '{n} 个技能',
        roots: '技能目录',
        restartNotNeeded: '这个改动不需要重启，刷新后即可看到结果。',
        allFamilies: '全部分类',
        manual: '手动',
        size: '{n} 个文件',
        copyDiag: '复制诊断信息',
        copyDiagHint: '复制版本号、服务可用性和路径，报问题时贴给作者。不含对话内容。',
        copyDiagDone: '诊断信息已复制到剪贴板，报问题时粘贴即可。',
        copyDiagFail: '复制失败，下面是诊断信息，手动选中复制：',
      },
      en: {
        title: 'Plugin Studio',
        subtitle: 'One page for plugins and skills: automatic three-level grouping, batch removal, plain-language explanations, last-used time, and packing.',
        tabPlugins: 'Plugins',
        tabSkills: 'Skills',
        tabPacks: 'Packs',
        refresh: 'Refresh',
        search: 'Search name, description or category…',
        filterAll: 'All',
        filterEnabled: 'Enabled',
        filterUnused: 'Unused 90d',
        filterRemovable: 'Removable',
        filterUnknown: 'Low confidence',
        viewTree: 'Grouped',
        viewList: 'List',
        expandAll: 'Expand all',
        collapseAll: 'Collapse all',
        selected: '{n} selected',
        clear: 'Clear',
        remove: 'Remove',
        explain: 'Explain',
        pack: 'Pack',
        enable: 'Enable',
        disable: 'Disable',
        selectAll: 'Select group',
        empty: 'Nothing here yet.',
        emptyFilter: 'No rows match the filter.',
        loading: 'Loading…',
        error: 'Something went wrong',
        retry: 'Retry',
        neverUsed: 'Never used',
        lastUsed: 'Last used: ',
        official: 'official',
        locked: 'locked',
        disabled: 'disabled',
        lowConf: 'low confidence',
        unregistered: 'unregistered',
        evidence: 'Evidence',
        what: 'What it does',
        removeEffect: 'If you remove it',
        why: 'Why',
        noExplain: 'No explanation yet. Press Explain to read its code and description.',
        explainRunning: 'Reading code and description…',
        explainDone: 'Explained {n} rows',
        explainPartial: 'Model explained {found}/{asked} rows; press again to fill the rest.',
        removeTitle: 'Confirm removal',
        removeBody: 'These will actually be removed, not hidden and not disabled.',
        removeSkillsBody: 'These skill directories will be deleted. A deleted directory does not come back.',
        cancel: 'Cancel',
        confirmRemove: 'Remove',
        removing: 'Removing…',
        restartTitle: 'Restart required',
        restartBody: 'The change is written, but the client must reload it. Quit and reopen DeepSeek Harness.',
        knowIt: 'Got it',
        removedOk: 'Removed {n}',
        removedFail: '{n} failed',
        packTitle: 'Pack',
        packName: 'Pack name',
        packSave: 'Save locally',
        packDownload: 'Download',
        packDone: 'Saved: {file}',
        packsEmpty: 'No saved packs yet. Select rows and press Pack.',
        packsDelete: 'Delete',
        usageSource: 'Usage read from {source}',
        usageNone: 'No sessions on this machine yet',
        aiStats: '{model} read {asked}, answered {found}',
        aiOff: 'AI unavailable: {reason}',
        warnings: 'Notes',
        family: 'Family',
        domain: 'Category',
        rows: '{n} plugins',
        skillsRows: '{n} skills',
        roots: 'Skill roots',
        restartNotNeeded: 'No restart needed; refresh to see the result.',
        allFamilies: 'All families',
        manual: 'manual',
        size: '{n} files',
        copyDiag: 'Copy diagnostics',
        copyDiagHint: 'Copies versions, service availability and paths for a bug report. No conversation content.',
        copyDiagDone: 'Diagnostics copied to the clipboard; paste them into your issue.',
        copyDiagFail: 'Copy failed. Select and copy the diagnostics below manually:',
      },
    }

    function makeT(locale) {
      const dict = DICT[String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh']
      return (key, vars) => {
        let text = dict[key] || DICT.zh[key] || key
        if (vars) {
          for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value))
        }
        return text
      }
    }

    /* -------------------------------------------------------------- */
    /* styles                                                          */
    /* -------------------------------------------------------------- */

    const STYLE_ID = 'dps-styles'

    const CSS = `
.dps-root { display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dps-head { display: flex; align-items: flex-start; gap: 12px; }
.dps-head h2 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: .2px; }
.dps-head p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); max-width: 62ch; }
.dps-head-actions { margin-left: auto; display: flex; gap: 8px; flex: none; }
.dps-tabs { display: flex; gap: 4px; align-items: center; border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 0; }
.dps-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px 8px 0 0; cursor: pointer; position: relative; }
.dps-tab[data-on="1"] { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dps-tab[data-on="1"]::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--dsw-alias-brand-primary); }
.dps-tab:hover { background: var(--dsw-alias-bg-layer-2); }
.dps-tab .dps-count { margin-left: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dps-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dps-input { flex: 1 1 220px; min-width: 160px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 7px 10px; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
.dps-diag { width: 100%; min-height: 220px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.5; white-space: pre; }
.dps-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dps-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.dps-chip { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 999px; cursor: pointer; }
.dps-chip[data-on="1"] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.dps-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; padding: 6px 11px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.dps-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.dps-btn:disabled { opacity: .5; cursor: default; }
.dps-btn[data-tone="danger"] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
.dps-btn[data-tone="brand"] { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); border-color: transparent; font-weight: 600; }
.dps-btn[data-size="sm"] { padding: 4px 8px; font-size: 11.5px; border-radius: 7px; }
.dps-sel { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.dps-sel strong { font-weight: 600; }
.dps-sel .dps-spacer { flex: 1; }
.dps-aistats { font-size: 11.5px; color: var(--dsw-alias-label-secondary); padding: 0 2px; }
.dps-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.dps-banner { display: flex; gap: 8px; align-items: flex-start; padding: 9px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.55; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.dps-banner[data-tone="err"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); color: var(--dsw-alias-state-error-primary); }
.dps-banner[data-tone="warn"] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); color: var(--dsw-alias-state-warn-primary); }
.dps-banner[data-tone="ok"] { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); color: var(--dsw-alias-state-success-primary); }
.dps-fam { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dps-fam:last-child { border-bottom: 0; }
.dps-famhead { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; user-select: none; background: var(--dsw-alias-bg-layer-2); }
.dps-famhead:hover { background: var(--dsw-alias-bg-overlay); }
.dps-caret { width: 14px; flex: none; color: var(--dsw-alias-label-secondary); transition: transform .12s ease; display: inline-flex; justify-content: center; }
.dps-caret[data-open="1"] { transform: rotate(90deg); }
.dps-famname { font-weight: 600; font-size: 13px; }
.dps-famhint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dps-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dps-badge[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent); }
.dps-badge[data-tone="idle"] { color: var(--dsw-alias-state-idle-primary); }
.dps-badge[data-tone="err"] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
.dps-dom { border-top: 1px solid var(--dsw-alias-border-l1); }
.dps-domhead { display: flex; align-items: center; gap: 8px; padding: 7px 12px 7px 26px; cursor: pointer; user-select: none; }
.dps-domhead:hover { background: var(--dsw-alias-bg-layer-2); }
.dps-domname { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dps-row { display: flex; gap: 10px; padding: 9px 12px 9px 44px; border-top: 1px solid var(--dsw-alias-border-l1); align-items: flex-start; }
.dps-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dps-row[data-sel="1"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); }
.dps-check { margin: 2px 0 0; flex: none; width: 15px; height: 15px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dps-check:disabled { cursor: default; opacity: .45; }
.dps-body { flex: 1; min-width: 0; }
.dps-name { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
.dps-name b { font-weight: 600; font-size: 13px; }
.dps-pkg { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dps-desc { margin-top: 3px; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.dps-meta { margin-top: 5px; display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dps-meta .dps-warn { color: var(--dsw-alias-state-warn-primary); }
.dps-row-actions { display: flex; gap: 6px; flex: none; align-items: center; }
.dps-ai { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; padding: 9px 11px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.dps-ai-line { display: flex; gap: 7px; font-size: 12.5px; line-height: 1.6; }
.dps-ai-line span:first-child { flex: none; color: var(--dsw-alias-label-secondary); min-width: 68px; }
.dps-empty { padding: 30px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dps-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: dps-spin .8s linear infinite; vertical-align: -2px; margin-right: 6px; }
@keyframes dps-spin { to { transform: rotate(360deg); } }
.dps-overlay { position: fixed; inset: 0; background: color-mix(in srgb, #000 45%, transparent); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px; }
.dps-modal { width: min(560px, 100%); max-height: 82vh; overflow: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.dps-modal h3 { margin: 0; font-size: 15px; font-weight: 600; }
.dps-modal p { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.dps-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 8px 10px; }
.dps-list div { font-size: 12.5px; display: flex; gap: 8px; align-items: baseline; }
.dps-list em { font-style: normal; color: var(--dsw-alias-state-error-primary); font-size: 11.5px; }
.dps-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.dps-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
`

    function ensureStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID)) return () => {}
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        if (style.parentNode) style.parentNode.removeChild(style)
      }
    }

    /* -------------------------------------------------------------- */
    /* data                                                            */
    /* -------------------------------------------------------------- */

    async function request(path, options) {
      const init = options || {}
      const response = await fetch(`${API}${path}`, {
        method: init.method || (init.body ? 'POST' : 'GET'),
        headers: init.body ? { 'content-type': 'application/json' } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        const message = payload && payload.error ? payload.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      if (payload && payload.ok === false && payload.error) throw new Error(payload.error)
      return payload
    }

    /* -------------------------------------------------------------- */
    /* small pieces                                                    */
    /* -------------------------------------------------------------- */

    function Icon(props) {
      const size = props.size || 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: props.d,
          stroke: 'currentColor',
          strokeWidth: props.weight || 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: props.fill || 'none',
        }),
      )
    }

    const CARET = 'M6 4l4 4-4 4'

    function Chip(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dps-chip',
          'data-on': props.on ? '1' : '0',
          onClick: props.onClick,
        },
        props.label,
      )
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dps-btn',
          'data-tone': props.tone || undefined,
          'data-size': props.size || undefined,
          disabled: props.disabled,
          title: props.title || undefined,
          onClick: props.onClick,
        },
        props.children,
      )
    }

    function Badge(props) {
      return h('span', { className: 'dps-badge', 'data-tone': props.tone || undefined }, props.children)
    }

    function Banner(props) {
      return h('div', { className: 'dps-banner', 'data-tone': props.tone || undefined }, props.children)
    }

    /* -------------------------------------------------------------- */
    /* the row                                                         */
    /* -------------------------------------------------------------- */

    function Row(props) {
      const { row, t, selected, onToggle, onExplain, busy, expanded, onExpand } = props
      const blocked = row.removable === false || !!row.readOnlyReason
      const meta = []
      if (row.usedAt) meta.push(h('span', { key: 'u' }, `${t('lastUsed')}${row.usedText || ''}`))
      else meta.push(h('span', { key: 'u', className: 'dps-warn' }, t('neverUsed')))
      if (row.rowCount > 0) meta.push(h('span', { key: 'r' }, `${row.rowCount} 个加载项`))
      if (row.bytes) meta.push(h('span', { key: 'b' }, t('size', { n: row.files || 0 })))
      if (row.dir && row.kind === 'skill') meta.push(h('span', { key: 'd', className: 'dps-mono' }, row.dir))

      const badges = []
      if (row.official) badges.push(h(Badge, { key: 'o' }, t('official')))
      if (row.enabled === false) badges.push(h(Badge, { key: 'd', tone: 'warn' }, t('disabled')))
      if (row.removable === false) badges.push(h(Badge, { key: 'l', tone: 'idle' }, row.readOnlyReason || t('locked')))
      if (row.registered === false) badges.push(h(Badge, { key: 'n', tone: 'warn' }, t('unregistered')))
      if (row.confidence === 'low') badges.push(h(Badge, { key: 'c', tone: 'warn' }, t('lowConf')))
      if (row.confidence === 'manual') badges.push(h(Badge, { key: 'm' }, t('manual')))

      const ai = row.ai

      return h(
        'div',
        { className: 'dps-row', 'data-sel': selected ? '1' : '0' },
        h('input', {
          className: 'dps-check',
          type: 'checkbox',
          checked: !!selected,
          disabled: blocked,
          title: blocked ? (row.readOnlyReason || t('locked')) : undefined,
          onChange: () => onToggle(row.key),
        }),
        h(
          'div',
          { className: 'dps-body' },
          h(
            'div',
            { className: 'dps-name' },
            h('b', null, row.title || row.name),
            row.title && row.title !== row.name ? h('span', { className: 'dps-pkg' }, row.name) : null,
            ...badges,
          ),
          row.description ? h('div', { className: 'dps-desc' }, row.description) : null,
          h('div', { className: 'dps-meta' }, ...meta),
          ai
            ? h(
              'div',
              { className: 'dps-ai' },
              h('div', { className: 'dps-ai-line' }, h('span', null, t('what')), h('span', null, ai.what || '—')),
              ai.remove ? h('div', { className: 'dps-ai-line' }, h('span', null, t('removeEffect')), h('span', null, ai.remove)) : null,
              ai.why ? h('div', { className: 'dps-ai-line' }, h('span', null, t('why')), h('span', null, ai.why)) : null,
            )
            : expanded
              ? h(
                'div',
                { className: 'dps-ai' },
                h('div', { className: 'dps-ai-line' }, h('span', null, t('evidence')), h('span', null, (row.evidence || []).join('；') || '—')),
                h('div', { className: 'dps-ai-line' }, h('span', null, t('what')), h('span', null, t('noExplain'))),
              )
              : null,
        ),
        h(
          'div',
          { className: 'dps-row-actions' },
          h(
            Button,
            { size: 'sm', disabled: busy, onClick: () => onExplain(row.key) },
            busy ? h('span', { className: 'dps-spin' }) : null,
            t('explain'),
          ),
          h(Button, { size: 'sm', onClick: () => onExpand(row.key) }, expanded ? '−' : '?'),
        ),
      )
    }

    /* -------------------------------------------------------------- */
    /* the inventory view (plugins and skills share it)                */
    /* -------------------------------------------------------------- */

    function InventoryView(props) {
      const { t, kind } = props
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [view, setView] = React.useState('tree')
      const [selected, setSelected] = React.useState(() => new Set())
      const [collapsed, setCollapsed] = React.useState(() => new Set())
      const [expanded, setExpanded] = React.useState(() => new Set())
      const [busyKeys, setBusyKeys] = React.useState(() => new Set())
      const [banner, setBanner] = React.useState(null)
      const [confirming, setConfirming] = React.useState(null)
      const [working, setWorking] = React.useState(false)
      const [aiStats, setAiStats] = React.useState(null)
      const [diagText, setDiagText] = React.useState(null)

      const load = React.useCallback(async () => {
        setState((prev) => ({ ...prev, status: prev.data ? 'refreshing' : 'loading', error: null }))
        try {
          const data = await request(kind === 'skill' ? '/skills' : '/inventory')
          setState({ status: 'ready', data, error: null })
          setSelected((prev) => {
            const keys = new Set((data.rows || []).map((row) => row.key))
            const next = new Set()
            for (const key of prev) if (keys.has(key)) next.add(key)
            return next
          })
        } catch (err) {
          setState({ status: 'error', data: null, error: err.message })
        }
      }, [kind])

      React.useEffect(() => {
        load()
      }, [load])

      const rows = (state.data && state.data.rows) || []
      const catalog = (state.data && state.data.catalog) || { families: [], domains: [] }
      const warnings = (state.data && state.data.warnings) || []

      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return rows.filter((row) => {
          if (filter === 'enabled' && row.enabled === false) return false
          if (filter === 'removable' && row.removable === false) return false
          if (filter === 'unknown' && row.confidence !== 'low') return false
          if (filter === 'unused') {
            const ninetyDays = 90 * 24 * 60 * 60 * 1000
            if (row.usedAt && Date.now() - row.usedAt < ninetyDays) return false
          }
          if (!needle) return true
          const hay = `${row.name} ${row.title || ''} ${row.description || ''} ${row.familyLabel || ''} ${row.domainLabel || ''}`
          return hay.toLowerCase().includes(needle)
        })
      }, [rows, query, filter])

      // Grouped by family then domain, in the order the Host's catalog declares
      // so the page and the classifier cannot disagree about ranking.
      const groups = React.useMemo(() => {
        const familyOrder = new Map((catalog.families || []).map((family) => [family.id, family.order || 999]))
        const domainOrder = new Map((catalog.domains || []).map((domain) => [domain.id, domain.order || 999]))
        const families = new Map()
        for (const row of filtered) {
          const familyId = row.family || 'other'
          if (!families.has(familyId)) {
            families.set(familyId, {
              id: familyId,
              label: row.familyLabel || familyId,
              hint: ((catalog.families || []).find((family) => family.id === familyId) || {}).hint || '',
              order: familyOrder.has(familyId) ? familyOrder.get(familyId) : 999,
              domains: new Map(),
            })
          }
          const family = families.get(familyId)
          const domainId = row.domain || `${familyId}.other`
          if (!family.domains.has(domainId)) {
            family.domains.set(domainId, {
              id: domainId,
              label: row.domainLabel || domainId,
              order: domainOrder.has(domainId) ? domainOrder.get(domainId) : 999,
              rows: [],
            })
          }
          family.domains.get(domainId).rows.push(row)
        }
        const out = [...families.values()].sort((a, b) => a.order - b.order)
        for (const family of out) {
          family.domains = [...family.domains.values()].sort((a, b) => a.order - b.order)
          family.count = family.domains.reduce((sum, domain) => sum + domain.rows.length, 0)
        }
        return out
      }, [filtered, catalog])

      const toggle = (key) => {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const selectGroup = (keys) => {
        setSelected((prev) => {
          const next = new Set(prev)
          const all = keys.every((key) => next.has(key))
          for (const key of keys) {
            if (all) next.delete(key)
            else next.add(key)
          }
          return next
        })
      }

      const toggleCollapse = (id) => {
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const toggleExpand = (key) => {
        setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const explain = async (keys) => {
        // Accept one key, an array of keys, or nothing (use the selection).
        // A bare string used to slip through `keys.length` and travel as a
        // string, so the server saw no array and explained the whole backlog.
        const list = keys == null
          ? [...selected]
          : (Array.isArray(keys) ? keys : [keys]).filter((key) => typeof key === 'string' && key.length > 0)
        if (list.length === 0) {
          setBanner({ tone: 'warn', text: '先勾选要讲解的条目，或直接点某一行的「AI 讲解」。' })
          return
        }
        setBusyKeys(new Set(list))
        setBanner({ tone: 'info', text: t('explainRunning') })
        try {
          const result = await request('/explain', { body: { kind, keys: list, limit: list.length, online: true } })
          setAiStats(result.stats)
          const stats = result.stats || {}
          const got = Array.isArray(result.notes) ? result.notes.length : 0
          if (stats.available === false) {
            setBanner({ tone: 'warn', text: t('aiOff', { reason: stats.reason || '' }) })
          } else if (got > 0) {
            // Report a partial answer instead of silently claiming success: the
            // model can drop rows, and the old banner hid which ones were lost.
            const asked = Number(stats.asked) || got
            setBanner(got < asked
              ? { tone: 'warn', text: t('explainPartial', { found: got, asked }) }
              : { tone: 'ok', text: t('explainDone', { n: got }) })
          } else if (stats.available && stats.failed > 0 && stats.reason) {
            setBanner({ tone: 'err', text: stats.reason })
          } else {
            setBanner({ tone: 'warn', text: t('aiOff', { reason: stats.reason || '模型没有返回可用的结果' }) })
          }
          await load()
        } catch (err) {
          setBanner({ tone: 'err', text: err.message })
        } finally {
          setBusyKeys(new Set())
        }
      }

      const askRemove = () => {
        const picked = rows.filter((row) => selected.has(row.key))
        if (picked.length === 0) return
        setConfirming(picked)
      }

      const doRemove = async () => {
        const picked = confirming || []
        setWorking(true)
        try {
          const result = await request(kind === 'skill' ? '/skills/remove' : '/remove', {
            body: { keys: picked.map((row) => row.key) },
          })
          const removed = result.removed || 0
          const failed = result.failed || 0
          const restart = result.restart
          if (restart && restart.required) {
            setBanner({ tone: 'warn', text: `${t('removedOk', { n: removed })}。${restart.text}` })
          } else if (failed > 0) {
            const first = (result.results || []).find((entry) => !entry.ok)
            setBanner({ tone: 'err', text: `${t('removedOk', { n: removed })}；${t('removedFail', { n: failed })}${first && (first.error || first.reason) ? `：${first.error || first.reason}` : ''}` })
          } else {
            setBanner({ tone: 'ok', text: t('removedOk', { n: removed }) })
          }
          setSelected(new Set())
          setConfirming(null)
          await load()
        } catch (err) {
          setBanner({ tone: 'err', text: err.message })
        } finally {
          setWorking(false)
        }
      }

      /**
       * Copy the diagnostic JSON to the clipboard.
       *
       * `navigator.clipboard` needs a secure context and is not available in
       * every shell the client runs in. The fallback is a modal with a
       * read-only textarea the user selects themselves — deliberately not a
       * hidden `document.body` node, because this plugin renders only inside
       * its own panel and must not touch the shell's DOM.
       */
      const copyDiag = async () => {
        try {
          const diag = await request('/diag')
          const text = JSON.stringify(diag, null, 2)
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text)
              setBanner({ tone: 'ok', text: t('copyDiagDone') })
              return
            }
          } catch {}
          setDiagText(text)
        } catch (err) {
          setBanner({ tone: 'err', text: err.message })
        }
      }

      const doPack = async () => {
        const picked = rows.filter((row) => selected.has(row.key))
        if (picked.length === 0) {
          setBanner({ tone: 'warn', text: '先勾选要打包的条目。' })
          return
        }
        setWorking(true)
        try {
          const name = `${kind === 'skill' ? '技能' : '插件'}整合包-${new Date().toISOString().slice(0, 10)}`
          if (kind === 'skill') {
            const result = await request('/skills/pack', { body: { keys: picked.map((row) => row.key), name } })
            setBanner({ tone: 'ok', text: `已打包到 ${result.dir}` })
          } else {
            const result = await request('/pack', { body: { keys: picked.map((row) => row.key), meta: { name } } })
            const saved = await request('/save', { body: { pack: result.pack } })
            setBanner({ tone: 'ok', text: t('packDone', { file: saved.file }) })
          }
        } catch (err) {
          setBanner({ tone: 'err', text: err.message })
        } finally {
          setWorking(false)
        }
      }

      const header = h(
        'div',
        null,
        h(
          'div',
          { className: 'dps-bar' },
          h('input', {
            className: 'dps-input',
            placeholder: t('search'),
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h(Button, { onClick: load, disabled: state.status === 'loading' }, state.status === 'loading' ? t('loading') : t('refresh')),
          h(Button, { onClick: () => setView(view === 'tree' ? 'list' : 'tree') }, view === 'tree' ? t('viewList') : t('viewTree')),
          // Bug reports are much easier to act on when the reporter can hand
          // over the environment in one paste. The payload is the same JSON the
          // `/diag` route serves: versions, which services resolved, paths.
          h(Button, { onClick: copyDiag, title: t('copyDiagHint') }, t('copyDiag')),
        ),
        h(
          'div',
          { className: 'dps-bar', style: { marginTop: 8 } },
          h(
            'div',
            { className: 'dps-chips' },
            h(Chip, { label: t('filterAll'), on: filter === 'all', onClick: () => setFilter('all') }),
            h(Chip, { label: t('filterEnabled'), on: filter === 'enabled', onClick: () => setFilter('enabled') }),
            h(Chip, { label: t('filterUnused'), on: filter === 'unused', onClick: () => setFilter('unused') }),
            h(Chip, { label: t('filterRemovable'), on: filter === 'removable', onClick: () => setFilter('removable') }),
            h(Chip, { label: t('filterUnknown'), on: filter === 'unknown', onClick: () => setFilter('unknown') }),
          ),
          h('span', { style: { flex: 1 } }),
          view === 'tree'
            ? h(
              Button,
              { size: 'sm', onClick: () => setCollapsed(new Set()) },
              t('expandAll'),
            )
            : null,
          view === 'tree'
            ? h(
              Button,
              { size: 'sm', onClick: () => setCollapsed(new Set(groups.map((group) => group.id))) },
              t('collapseAll'),
            )
            : null,
        ),
      )

      const selectionBar = selected.size > 0
        ? h(
          'div',
          { className: 'dps-sel' },
          h('strong', null, t('selected', { n: selected.size })),
          h('span', { className: 'dps-spacer' }),
          h(Button, { size: 'sm', onClick: () => explain() }, t('explain')),
          h(Button, { size: 'sm', onClick: doPack, disabled: working }, t('pack')),
          h(Button, { size: 'sm', tone: 'danger', onClick: askRemove, disabled: working }, t('remove')),
          h(Button, { size: 'sm', onClick: () => setSelected(new Set()) }, t('clear')),
        )
        : null

      const renderRow = (row) =>
        h(Row, {
          key: row.key,
          row,
          t,
          selected: selected.has(row.key),
          onToggle: toggle,
          onExplain: explain,
          onExpand: toggleExpand,
          expanded: expanded.has(row.key),
          busy: busyKeys.has(row.key),
        })

      let body = null
      if (state.status === 'loading' && !state.data) {
        body = h('div', { className: 'dps-empty' }, h('span', { className: 'dps-spin' }), t('loading'))
      } else if (state.status === 'error') {
        body = h(
          'div',
          { className: 'dps-empty' },
          h('div', null, `${t('error')}：${state.error}`),
          h('div', { style: { marginTop: 10 } }, h(Button, { onClick: load }, t('retry'))),
        )
      } else if (filtered.length === 0) {
        body = h('div', { className: 'dps-empty' }, rows.length === 0 ? t('empty') : t('emptyFilter'))
      } else if (view === 'list') {
        body = h('div', { className: 'dps-card' }, filtered.map(renderRow))
      } else {
        body = h(
          'div',
          { className: 'dps-card' },
          groups.map((family) => {
            const isCollapsed = collapsed.has(family.id)
            const keys = family.domains.flatMap((domain) => domain.rows.filter((row) => row.removable !== false).map((row) => row.key))
            return h(
              'div',
              { className: 'dps-fam', key: family.id },
              h(
                'div',
                { className: 'dps-famhead', onClick: () => toggleCollapse(family.id) },
                h('span', { className: 'dps-caret', 'data-open': isCollapsed ? '0' : '1' }, h(Icon, { d: CARET, size: 12 })),
                h('span', { className: 'dps-famname' }, family.label),
                h('span', { className: 'dps-famhint' }, family.hint),
                h('span', { style: { flex: 1 } }),
                h(Badge, null, kind === 'skill' ? t('skillsRows', { n: family.count }) : t('rows', { n: family.count })),
                keys.length > 0
                  ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dps-btn',
                      'data-size': 'sm',
                      onClick: (event) => {
                        event.stopPropagation()
                        selectGroup(keys)
                      },
                    },
                    t('selectAll'),
                  )
                  : null,
              ),
              isCollapsed
                ? null
                : family.domains.map((domain) =>
                  h(
                    'div',
                    { className: 'dps-dom', key: domain.id },
                    h(
                      'div',
                      { className: 'dps-domhead', onClick: () => toggleCollapse(domain.id) },
                      h('span', { className: 'dps-caret', 'data-open': collapsed.has(domain.id) ? '0' : '1' }, h(Icon, { d: CARET, size: 11 })),
                      h('span', { className: 'dps-domname' }, domain.label),
                      h('span', { className: 'dps-badge' }, domain.rows.length),
                    ),
                    collapsed.has(domain.id) ? null : domain.rows.map(renderRow),
                  ),
                ),
            )
          }),
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        header,
        warnings.length > 0 ? h(Banner, { tone: 'warn' }, h('div', null, h('b', null, t('warnings')), `：${warnings.slice(0, 3).join('；')}`)) : null,
        banner ? h(Banner, { tone: banner.tone === 'info' ? undefined : banner.tone }, banner.text) : null,
        aiStats && aiStats.available !== false
          ? h(
            'div',
            { className: 'dps-aistats' },
            t('aiStats', { model: aiStats.model || '—', asked: Number(aiStats.asked) || 0, found: Number(aiStats.found) || 0 }),
            aiStats.inputTokens || aiStats.outputTokens
              ? ` · ${Number(aiStats.inputTokens) || 0}→${Number(aiStats.outputTokens) || 0} tokens`
              : '',
          )
          : null,
        selectionBar,
        body,
        confirming
          ? h(
            'div',
            { className: 'dps-overlay', onClick: (event) => { if (event.target === event.currentTarget && !working) setConfirming(null) } },
            h(
              'div',
              { className: 'dps-modal' },
              h('h3', null, t('removeTitle')),
              h('p', null, kind === 'skill' ? t('removeSkillsBody') : t('removeBody')),
              h(
                'div',
                { className: 'dps-list' },
                confirming.map((row) =>
                  h(
                    'div',
                    { key: row.key },
                    h('span', null, row.title || row.name),
                    h('span', { className: 'dps-pkg' }, row.name),
                    row.removable === false ? h('em', null, row.readOnlyReason || t('locked')) : null,
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dps-modal-actions' },
                h(Button, { onClick: () => setConfirming(null), disabled: working }, t('cancel')),
                h(Button, { tone: 'danger', onClick: doRemove, disabled: working }, working ? t('removing') : t('confirmRemove')),
              ),
            ),
          )
          : null,
        // The clipboard fallback. `navigator.clipboard` is missing in some
        // shells, and a button that appears to do nothing is worse than one
        // that shows you the text to copy yourself.
        diagText
          ? h(
            'div',
            { className: 'dps-overlay', onClick: (event) => { if (event.target === event.currentTarget) setDiagText(null) } },
            h(
              'div',
              { className: 'dps-modal' },
              h('h3', null, t('copyDiag')),
              h('p', null, t('copyDiagFail')),
              h('textarea', {
                className: 'dps-input dps-diag',
                readOnly: true,
                value: diagText,
                rows: 14,
                onFocus: (event) => event.target.select(),
              }),
              h(
                'div',
                { className: 'dps-modal-actions' },
                h(Button, { onClick: () => setDiagText(null) }, t('knowIt')),
              ),
            ),
          )
          : null,
      )
    }

    /* -------------------------------------------------------------- */
    /* packs tab                                                       */
    /* -------------------------------------------------------------- */

    function PacksView(props) {
      const { t } = props
      const [state, setState] = React.useState({ status: 'loading', saved: [], error: null })
      const [banner, setBanner] = React.useState(null)

      const load = React.useCallback(async () => {
        setState((prev) => ({ ...prev, status: 'loading' }))
        try {
          const data = await request('/saved')
          setState({ status: 'ready', saved: data.saved || [], error: null })
        } catch (err) {
          setState({ status: 'error', saved: [], error: err.message })
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const drop = async (file) => {
        try {
          await request('/delete-pack', { body: { file } })
          setBanner({ tone: 'ok', text: `已删除 ${file}` })
          await load()
        } catch (err) {
          setBanner({ tone: 'err', text: err.message })
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(
          'div',
          { className: 'dps-bar' },
          h(Button, { onClick: load, disabled: state.status === 'loading' }, state.status === 'loading' ? t('loading') : t('refresh')),
        ),
        banner ? h(Banner, { tone: banner.tone }, banner.text) : null,
        state.status === 'error' ? h(Banner, { tone: 'err' }, state.error) : null,
        state.saved.length === 0
          ? h('div', { className: 'dps-empty' }, t('packsEmpty'))
          : h(
            'div',
            { className: 'dps-card' },
            state.saved.map((item) =>
              h(
                'div',
                { className: 'dps-row', key: item.file, style: { paddingLeft: 12 } },
                h(
                  'div',
                  { className: 'dps-body' },
                  h('div', { className: 'dps-name' }, h('b', null, item.name), h('span', { className: 'dps-pkg' }, item.file)),
                  h(
                    'div',
                    { className: 'dps-meta' },
                    h('span', null, `${item.count} 项`),
                    item.createdAt ? h('span', null, new Date(item.createdAt).toLocaleString()) : null,
                  ),
                ),
                h('div', { className: 'dps-row-actions' }, h(Button, { size: 'sm', tone: 'danger', onClick: () => drop(item.file) }, t('packsDelete'))),
              ),
            ),
          ),
      )
    }

    /* -------------------------------------------------------------- */
    /* root                                                            */
    /* -------------------------------------------------------------- */

    function Studio(props) {
      const { t, apiMismatch } = props
      const [tab, setTab] = React.useState('plugin')
      const [counts, setCounts] = React.useState({ plugin: null, skill: null })

      React.useEffect(() => {
        let alive = true
        const grab = async (kind, path) => {
          try {
            const data = await request(path)
            return (data.rows || []).length
          } catch {
            return null
          }
        }
        Promise.all([grab('plugin', '/inventory'), grab('skill', '/skills')]).then(([plugin, skill]) => {
          if (alive) setCounts({ plugin, skill })
        })
        return () => {
          alive = false
        }
      }, [])

      const tabs = [
        ['plugin', t('tabPlugins'), counts.plugin],
        ['skill', t('tabSkills'), counts.skill],
        ['pack', t('tabPacks'), null],
      ]

      return h(
        'div',
        { className: 'dps-root' },
        h(
          'div',
          { className: 'dps-head' },
          h('div', null, h('h2', null, t('title')), h('p', null, t('subtitle'))),
          h('div', { className: 'dps-head-actions' }, h(Icon, { d: 'M8 1.5v13M1.5 8h13', size: 15 })),
        ),
        apiMismatch ? h(Banner, { tone: 'err' }, apiMismatch) : null,
        h(
          'div',
          { className: 'dps-tabs' },
          tabs.map(([id, label, count]) =>
            h(
              'button',
              { key: id, type: 'button', className: 'dps-tab', 'data-on': tab === id ? '1' : '0', onClick: () => setTab(id) },
              label,
              count === null || count === undefined ? null : h('span', { className: 'dps-count' }, count),
            ),
          ),
        ),
        tab === 'plugin' ? h(InventoryView, { t, kind: 'plugin' }) : null,
        tab === 'skill' ? h(InventoryView, { t, kind: 'skill' }) : null,
        tab === 'pack' ? h(PacksView, { t }) : null,
      )
    }

    /* -------------------------------------------------------------- */
    /* apply                                                           */
    /* -------------------------------------------------------------- */

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ensureStyles(), 'dsh-plugin-studio: styles')

        let locale = 'zh'
        try {
          if (ctx.locale && typeof ctx.locale.getLocale === 'function') locale = ctx.locale.getLocale() || 'zh'
        } catch {
          locale = 'zh'
        }

        const probe = async () => {
          try {
            const response = await fetch(`${API}/`, { method: 'GET' })
            if (!response.ok) return `宿主接口返回 HTTP ${response.status}，插件可能没有加载完整。`
            const payload = await response.json()
            if (payload && typeof payload.apiVersion === 'number' && payload.apiVersion !== API_VERSION) {
              return `客户端与宿主接口版本不一致（客户端 ${API_VERSION}，宿主 ${payload.apiVersion}），请重启客户端。`
            }
          } catch (err) {
            return `连不上宿主接口：${err.message}`
          }
          return null
        }

        function Panel() {
          const [mismatch, setMismatch] = React.useState(null)
          React.useEffect(() => {
            let alive = true
            probe().then((message) => {
              if (alive) setMismatch(message)
            })
            return () => {
              alive = false
            }
          }, [])
          return h(Studio, { t: makeT(locale), apiMismatch: mismatch })
        }

        const seat = (key, order, label) => {
          try {
            ctx.effect(
              () => ctx.slots.inject(key, () => ctx.slots.register({ name: key, id: 'plugin-studio', order, label }, Panel)),
              `dsh-plugin-studio: ${key}`,
            )
          } catch {
            // A build that does not declare this slot should not lose the other one.
          }
        }

        seat('settings.section', 18, makeT(locale)('title'))
      },
    }
  },
})
