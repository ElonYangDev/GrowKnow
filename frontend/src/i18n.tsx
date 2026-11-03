import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { FileStatus, KbKind, Skill } from './types'

export type Lang = 'zh' | 'en'
export type LangPref = 'auto' | Lang

type Plural = { one: string; other: string }
type Entry = string | Plural

const STORAGE_KEY = 'growknow.lang'

/** 中文文案以当前页面实际展示内容为准；英文为对应翻译。 */
const zh = {
  // ---------- 通用 ----------
  'common.cancel': '取消',
  'common.save': '保存',
  'common.saveChanges': '保存修改',
  'common.delete': '删除',
  'common.clear': '清除',
  'common.back': '返回',
  'common.close': '关闭',
  'common.remove': '移除',
  'common.refresh': '刷新',
  'common.copy': '复制',
  'common.copyUrl': '复制地址',
  'common.copyCode': '复制代码',
  'common.copied': '已复制到剪贴板',
  'common.copyFailed': '复制失败，请手动选择文本',
  'common.test': '测试连接',
  'common.hiddenSaved': '已保存，留空表示保持不变',
  'common.notSet': '未设置',
  'common.showHide': '显示或隐藏',
  'common.failed': '失败',
  'common.optional': '可选',
  'common.loading': '加载中',
  'common.actionFailed': '操作失败',
  'api.networkError': '无法连接服务，请检查后端是否已启动',
  'api.requestFailed': '请求失败（HTTP {status}）',

  // ---------- 应用 ----------
  'app.notFoundTitle': '页面不存在',
  'app.notFoundHint': '地址可能已变更，回到知识库列表重新开始。',
  'app.notFoundAction': '返回知识库',
  'app.documentTitle': 'GrowKnow · 知识库',
  'app.description': 'GrowKnow · 让智能体成为领域专家',

  // ---------- 侧边栏 ----------
  'layout.openMenu': '打开菜单',
  'layout.closeMenu': '关闭菜单',
  'layout.kbHeading': '知识库',
  'layout.newKb': '新建知识库',
  'layout.noKb': '还没有知识库',
  'layout.createFirst': '创建第一个',
  'layout.pendingFiles': '{n} 个文件抽取中',
  'layout.skills': '知识抽取 skill',
  'layout.settings': '系统设置',
  'layout.footer': '向量 · 三元组 · 图谱，一处生长',

  // ---------- 进度 ----------
  'progress.queued': '排队中',
  'progress.extracting': '抽取中',
  'progress.waiting': '等待调度',
  'progress.elapsed': '已用 {time}',

  // ---------- 知识形态 ----------
  'kind.vector': '全文向量库',
  'kind.triple': '三元组库',
  'kind.graph': '知识图谱',
  'kind.vectorShort': '向量库',
  'kind.tripleShort': '三元组',
  'kind.graphShort': '图谱',
  'kind.targetTriple': '三元组库',
  'kind.targetGraph': '知识图谱',
  'kind.targetAny': '通用',

  // ---------- 文件状态 ----------
  'status.queued': '等待中',
  'status.extracting': '抽取中',
  'status.ready': '抽取完成',
  'status.failed': '抽取失败',
  'status.canceled': '已取消',

  // ---------- 知识库列表 ----------
  'kbList.title': '知识库',
  'kbList.desc':
    '同一份文档，三种知识形态：全文向量库负责广度，三元组库负责密度，知识图谱负责关系。',
  'kbList.newKb': '新建知识库',
  'kbList.loading': '正在读取知识库…',
  'kbList.emptyTitle': '还没有知识库',
  'kbList.emptyHint':
    '上传一份 PDF / Word，平台会自动完成解析、切片与知识抽取。第一次建库建议从向量库开始。',
  'kbList.emptyAction': '创建第一个知识库',
  'kbList.noDesc': '未填写描述',
  'kbList.files': '{n} 文件',
  'kbList.knowledge': '{n} 知识',
  'kbList.entities': '{n} 实体',
  'kbList.filesUnit': '文件',
  'kbList.knowledgeUnit': '知识',
  'kbList.entitiesUnit': '实体',
  'kbList.pending': '{n} 抽取中',
  'kbList.updated': '更新于 {time}',

  // ---------- 知识库详情 ----------
  'kbPage.loadFailed': '加载知识库失败',
  'kbPage.notOpenTitle': '无法打开这个知识库',
  'kbPage.notOpenHint': '它可能已被删除，或 ID 已变更。',
  'kbPage.backToList': '返回知识库列表',
  'kbPage.noDesc': '未填写描述，可在「知识库管理」补充领域背景。',
  'kbPage.files': '{n} 文件',
  'kbPage.knowledge': '{n} 条知识',
  'kbPage.filesUnit': '文件',
  'kbPage.knowledgeUnit': '条知识',
  'kbPage.entitiesUnit': '实体',
  'kbPage.relationsUnit': '关系',
  'kbPage.entitiesRelations': '{nodes} 实体 · {edges} 关系',
  'kbPage.extracting': '抽取进行中',
  'kbPage.updated': '更新于 {time}',
  'kbPage.manage': '知识库管理',
  'kbPage.fileManager': '文件管理',
  'kbPage.invocation': '调用方法',
  'kbPage.filesHeading': '文件',
  'kbPage.filesSubtitle': '{n} 份 · 点击可筛选',
  'kbPage.downloadSelected': '下载所选文件',
  'kbPage.deleteSelected': '删除所选文件及其知识',
  'kbPage.addFile': '添加文件',
  'kbPage.selectedOnly': '仅看已选 {n} 个文件',
  'kbPage.noFiles': '还没有文件',
  'kbPage.uploadFile': '上传文件',
  'kbPage.knowledgeCount': '{n} 条知识',
  'kbPage.uploadedAt': '上传于 {time}',
  'kbPage.cancelExtraction': '取消抽取',
  'kbPage.downloadOriginal': '下载原文件',
  'kbPage.openFileManager': '打开文件管理 · 批量下载 / 删除 / 重试',
  'kbPage.panelVector': '全文切片',
  'kbPage.panelTriple': '三元组知识',
  'kbPage.panelGraph': '知识图谱',
  'kbPage.searchSummary': '检索「{query}」 · {n} 条命中',
  'kbPage.total': '共 {n} 条',
  'kbPage.graphSummary': '{nodes} 个实体 · {edges} 条关系',
  'kbPage.awaiting': '等待首批知识',
  'kbPage.searchGraph': '搜索实体…',
  'kbPage.searchTriple': '搜索主体 / 关系 / 客体…',
  'kbPage.searchVector': '语义检索切片…',
  'kbPage.search': '检索',
  'kbPage.emptyUploadTitle': '上传第一份文件',
  'kbPage.emptyUploadHint':
    '支持 PDF / DOC / DOCX。平台会先解析版面，再按你设定的页数切片并抽取知识。',
  'kbPage.emptyUploadAction': '添加文件',
  'kbPage.reading': '正在读取知识…',
  'kbPage.graphBuilding': '图谱正在构建',
  'kbPage.graphEmpty': '图谱还是空的',
  'kbPage.graphBuildingHint': '文件正在抽取，完成后实体与关系会自动出现在这里。',
  'kbPage.graphEmptyHint': '确认文件抽取状态；若抽取失败，可在文件管理中重试。',
  'kbPage.notVectorized': '未向量化',
  'kbPage.notVectorizedHint': '该切片尚未生成向量，仅支持关键词检索',
  'kbPage.collapse': '收起',
  'kbPage.expand': '展开全文',
  'kbPage.storedAt': '入库于 {time}',
  'kbPage.chunksBuilding': '正在生成切片',
  'kbPage.chunksEmpty': '还没有切片',
  'kbPage.chunksBuildingHint': '解析与向量化进行中，稍候片刻。',
  'kbPage.chunksEmptyHint': '该知识库暂时没有可用切片。',
  'kbPage.triplesBuilding': '正在抽取三元组',
  'kbPage.triplesEmpty': '还没有三元组',
  'kbPage.triplesBuildingHint': '抽取引擎正在逐片阅读文档。',
  'kbPage.triplesEmptyHint': '该知识库暂时没有抽取结果。',
  'kbPage.prev': '上一页',
  'kbPage.next': '下一页',
  'kbPage.pageOf': '第 {page} / {total} 页',
  'kbPage.page': '第 {page} 页',
  'kbPage.deleteTitle': '删除文件',
  'kbPage.deleteMessagePrefix': '将删除 ',
  'kbPage.deleteMessageMiddle': ' 个文件，并连带删除这些文件产生的全部知识（切片 / 三元组 / 图谱节点）。原始文件也会从服务器移除，操作不可撤销。',
  'kbPage.searchGraphEmpty': '图谱中没有匹配的实体',
  'kbPage.searchGraphEmptyHint': '试试实体全称，或换一个关键词。',
  'kbPage.clearSearch': '清除检索',
  'kbPage.hitEntities': '命中 {n} 个实体，展示其邻域',
  'kbPage.exitSearch': '退出检索',
  'kbPage.noHit': '没有命中知识',
  'kbPage.noHitHint': '换一个更具体的关键词，或确认对应文件已完成抽取。',
  'kbPage.backToBrowse': '返回浏览',
  'kbPage.tripleHits': '{n} 条相关三元组（{mode}）',
  'kbPage.modeKeyword': '关键词命中',
  'kbPage.modeHybrid': '混合排序',
  'kbPage.chunkHits': '{n} 条相关切片 · {mode}',
  'kbPage.modeVector': '语义召回',
  'kbPage.modeMixed': '语义 + 关键词',
  'kbPage.modeFallback': '关键词兜底',

  // ---------- 新建知识库 ----------
  'newKb.back': '返回',
  'newKb.title': '新建知识库',
  'newKb.desc': '根据知识的特点，选择最适合的知识形态',
  'newKb.name': '知识库名称',
  'newKb.editableAfterCreate': '必填，创建后可修改',
  'newKb.namePlaceholder': '例如：实验室设备操作手册',
  'newKb.nameHelp': '支持英文、中文、数字、符号',
  'newKb.id': '知识库 ID',
  'newKb.idHelp': '仅支持英文字母、数字、- 与 _；调用知识库需使用知识库ID',
  'newKb.description': '描述',
  'newKb.optionalEditable': '选填，创建后可修改',
  'newKb.descriptionPlaceholder':
    '这个知识库收录什么、面向谁使用。描述会作为抽取时的领域背景。',
  'newKb.kind': '知识形态',
  'newKb.kindFixed': '必填，创建后不可修改',
  'newKb.vectorTitle': '全文向量库',
  'newKb.vectorTagline': '原文切片、Embedding后存入数据库',
  'newKb.vectorPros': '构建速度最快，适合各种类型的知识和文档',
  'newKb.vectorCons': '知识密度低，召回精度有限',
  'newKb.tripleTitle': '三元组库',
  'newKb.tripleTagline': '主体—关系—客体',
  'newKb.triplePros': '知识密度高，检索高效且准确',
  'newKb.tripleCons': '适用范围有限，只适合条目清晰的客观事实类知识',
  'newKb.graphTitle': '知识图谱',
  'newKb.graphTagline': '节点-关系-节点',
  'newKb.graphPros': '能表达知识间的关联关系，可拓展性最强',
  'newKb.graphCons': '构建速度慢，整理和维护成本高',
  'newKb.nameRequired': '请填写知识库名称',
  'newKb.idInvalid': '知识库 ID 需以字母或数字开头，仅含字母、数字、- 和 _，长度 2-64',
  'newKb.created': '知识库已创建',
  'newKb.create': '创建知识库',

  // ---------- 系统设置 ----------
  'settings.loading': '正在读取系统设置…',
  'settings.loadFailed': '加载设置失败',
  'settings.depsFailed': '读取服务状态失败',
  'settings.title': '系统设置',
  'settings.desc': '模型配置保存后对新任务立即生效。',
  'settings.save': '保存设置',
  'settings.saveFailed': '保存失败',
  'settings.savedHot': '设置已保存，抽取引擎已同步',
  'settings.savedNoHot': '设置已保存；抽取引擎暂未热更新：{reason}',
  'settings.testOk': '连接正常（{ms} ms）',
  'settings.testOkLabel': '{label} 连接正常',
  'settings.testFailLabel': '{label} 连接失败',
  'settings.testFailed': '连接失败',
  'settings.embDims': '{model} · {dims} 维',
  'settings.providerReady': 'provider 已注册',
  'settings.providerMissing': 'provider 未注册',
  'settings.llmTitle': 'LLM 配置',
  'settings.llmDesc': '用于三元组库、知识图谱的知识抽取',
  'settings.baseUrl': 'Base URL',
  'settings.baseUrlHint': '支持 OpenAI 协议的 Base URL，通常以 /v1 结尾',
  'settings.model': '模型名',
  'settings.apiKey': 'API Key',
  'settings.embTitle': '向量嵌入服务',
  'settings.embDesc': '用于全文向量库的切片向量化',
  'settings.embFallbackNow': '当前复用 LLM 配置',
  'settings.embBaseHint':
    'OpenAI 兼容 Base URL。留空则自动复用 LLM 的 Base URL与 API Key',
  'settings.embBasePlaceholder': '留空则自动复用 LLM 的 Base URL',
  'settings.embKeyPlaceholder': '留空则自动复用 LLM 的 API Key',
  'settings.mineruTitle': 'MinerU 版面解析',
  'settings.mineruDesc': '用于 pdf、doc、xls、图片等多格式文件的版面解析与内容提取',
  'settings.service': '解析服务',
  'settings.mineruAgent': '官方轻量解析 API · 免费、免注册',
  'settings.mineruPrecision': '官方精准解析 API · 需注册、申请',
  'settings.mineruSelfhost': '本地 API · 需本地部署 MinerU',
  'settings.mineruAgentHint':
    '使用 MinerU 官方提供的轻量解析 API。免费，免注册。有频率限制，单文件不超过 10MB / 20 页，不提供页码定位。',
  'settings.mineruToken': 'API Token',
  'settings.mineruTokenHint': '在 mineru.net 控制台申请',
  'settings.mineruTokenPlaceholder': '输入您的 MinerU API Token',
  'settings.mineruPrecisionHint':
    '使用 MinerU 官方提供的精准解析 API。单文件不超过 200MB / 200 页，提供页码定位。API Token申请地址：https://mineru.net/apiManage/token',
  'settings.tier': '解析档位',
  'settings.tierFlash': 'flash · 适合格式简单的文档',
  'settings.tierStandard': 'standard · 适合有复杂公式、表格的文档',
  'settings.tierAdvanced': 'advanced · 最精细',
  'settings.selfhostHint': '需要在本地部署 MinerU。',
  'settings.statusTitle': '服务状态',
  'settings.statusDesc': '容器内网服务由平台自动连接。',
  'settings.statusDescAt': '容器内网服务由平台自动连接 · 检测于 {time}。',
  'settings.recheck': '重新检测',
  'settings.running': '运行正常',
  'settings.checking': '检测中…',
  'settings.opencodeUrl': 'opencode 地址：',
  'settings.opencodeEngine': 'opencode 引擎',
  'settings.checkEngine': '检测引擎',
  'settings.languageTitle': '界面语言',
  'settings.languageDesc': '默认跟随浏览器语言，也可以在下方手动选择。',
  'settings.languageAuto': '跟随浏览器',
  'settings.languageZh': '简体中文',
  'settings.languageEn': 'English',

  // ---------- 知识抽取 skill ----------
  'skills.loading': '正在读取 skill…',
  'skills.loadFailed': '加载 skill 失败',
  'skills.title': '知识抽取 skill',
  'skills.desc':
    '抽取 skill 是一份写给抽取引擎的 skill.md：规定要抽取什么内容、如何表述。保存后下次抽取立即生效，不影响已经抽取的知识。',
  'skills.new': '新建 skill',
  'skills.emptyList': '还没有 skill',
  'skills.builtin': '内置',
  'skills.filesUsing': '{n} 个文件在用',
  'skills.selectTitle': '选择或新建一个 skill',
  'skills.selectHint':
    'skill 决定文档会被抽取成什么样的知识。内置的三元组与图谱 skill 可直接使用，也可复制改造。',
  'skills.editTitle': '编辑 skill',
  'skills.createTitle': '新建 skill',
  'skills.lastUpdated': '最后更新 {time}',
  'skills.fillFirst': '填写名称与标识后保存',
  'skills.unsaved': '未保存',
  'skills.name': '名称',
  'skills.namePlaceholder': '例如：法规条款抽取',
  'skills.slug': '标识',
  'skills.slugHint': '小写字母、数字与 -',
  'skills.target': '适用知识库',
  'skills.description': '简介',
  'skills.descriptionPlaceholder': '一句话说明适用场景',
  'skills.content': 'skill.md 内容',
  'skills.contentHint': 'JSON 输出契约由程序自动追加，无需在内容里重复',
  'skills.chars': '{n} 字符 · 建议写清抽取范围、质量规范与示例',
  'skills.builtinHint': '这是内置 skill，可以修改内容，但不可删除。',
  'skills.deleteTitle': '删除 skill「{name}」',
  'skills.deleteMessage': '已使用该 skill 抽取的知识会保留，但后续无法再用它抽取新文件。',
  'skills.errorEmpty': '名称、标识与内容不能为空',
  'skills.created': 'skill 已创建，下次抽取生效',
  'skills.saved': 'skill 已保存，下次抽取生效',
  'skills.deleted': 'skill 已删除',
  'skills.saveFailed': '保存失败',
  'skills.deleteFailed': '删除失败',
  'skills.builtinGenericTriple': '通用三元组抽取',
  'skills.builtinLegalTriple': '法规条款抽取',
  'skills.builtinGenericGraph': '通用知识图谱抽取',

  // ---------- 上传 ----------
  'upload.title': '添加文件',
  'upload.subtitle': '上传到「{name}」，解析与抽取在后台自动完成',
  'upload.filesSelected': '{n} 个文件 · {size}',
  'upload.supports': '支持 PDF / DOC / DOCX',
  'upload.start': '开始抽取',
  'upload.dropTitle': '拖拽文件到这里，或点击选择',
  'upload.dropHint': '可一次选择多份 PDF / DOC / DOCX，单文件不超过 100MB',
  'upload.skipUnsupported': '已跳过不支持的文件：{names}',
  'upload.overSize': '{name}（超过 100MB）',
  'upload.chooseFirst': '请先选择文件',
  'upload.chooseSkill': '请选择知识抽取 skill',
  'upload.queued': '已上传 {n} 个文件，抽取任务已排队',
  'upload.failed': '上传失败，请稍后重试',
  'upload.pages': '文档切片页数',
  'upload.pagesHint': '每片约 N 页，遇章节标题提前断开',
  'upload.decrease': '减少',
  'upload.increase': '增加',
  'upload.skill': '知识抽取 skill',
  'upload.vectorHint': '向量库直接对切片做语义向量化，不需要抽取 skill，会保留完整原文。',
  'upload.skillHint': '决定抽取哪些知识、按什么粒度',

  // ---------- 文件管理 ----------
  'fm.title': '文件管理',
  'fm.subtitle': '{name} · 共 {n} 个文件（完成 {ready} / 进行中 {running} / 失败 {failed}{canceled}）',
  'fm.canceledPart': ' / 已取消 {n}',
  'fm.selected': '已选 {n} 个文件',
  'fm.deleteNote': '删除文件会同时删除其产生的知识',
  'fm.batchDownload': '批量下载',
  'fm.deleteSelected': '删除所选',
  'fm.upload': '上传文件',
  'fm.emptyTitle': '还没有文件',
  'fm.emptyHint': '上传 PDF / DOC / DOCX，平台会自动解析版面、按页切片并抽取知识。',
  'fm.fileName': '文件名',
  'fm.uploaded': '上传日期',
  'fm.status': '状态',
  'fm.knowledge': '知识数',
  'fm.actions': '操作',
  'fm.selectAll': '全选',
  'fm.selectFile': '选择 {name}',
  'fm.pages': '{n} 页',
  'fm.retry': '重试抽取',
  'fm.retrySuccess': '已重新排队抽取',
  'fm.retryFailed': '重试失败',
  'fm.cancelSuccess': '已发送取消请求',
  'fm.cancelFailed': '取消失败',
  'fm.deleteSuccess': '已删除 {n} 个文件及其关联知识',
  'fm.deleteFailed': '删除失败',
  'fm.deleteTitle': '删除文件',
  'fm.deleteMessagePrefix': '将删除 ',
  'fm.deleteMessageMiddle': ' 个文件，并连带删除这些文件产生的全部知识（切片 / 三元组 / 图谱节点）。原始文件也会从服务器移除，操作不可撤销。',

  // ---------- 知识库管理 ----------
  'kbSet.title': '知识库管理',
  'kbSet.name': '名称',
  'kbSet.nameHint': '支持英文、中文、数字、符号',
  'kbSet.id': '知识库 ID',
  'kbSet.idHint': '仅支持英文字母、数字、- 与 _',
  'kbSet.description': '描述',
  'kbSet.idWarning': '修改 ID 会改变调用地址（旧地址立即失效），已入库知识会保留并迁移。',
  'kbSet.nameRequired': '知识库名称不能为空',
  'kbSet.idInvalid': '知识库 ID 需以字母或数字开头，仅含字母、数字、- 和 _，长度 2-64',
  'kbSet.updated': '知识库已更新',
  'kbSet.deleted': '知识库已删除',
  'kbSet.saveFailed': '保存失败',
  'kbSet.deleteFailed': '删除失败',
  'kbSet.dangerTitle': '删除知识库',
  'kbSet.dangerDesc': '连同所有文件、切片、三元组与图谱数据一起删除，无法恢复。',
  'kbSet.delete': '删除知识库',
  'kbSet.confirmTitle': '删除「{name}」',
  'kbSet.confirmPrefix': '该知识库下的 ',
  'kbSet.confirmMiddle': ' 个文件与 ',
  'kbSet.confirmSuffix': ' 条知识将被永久删除，原始文件也会从服务器移除。此操作不可撤销。',

  // ---------- 调用方法 ----------
  'inv.title': '调用方法',
  'inv.subtitle': '「{name}」对外提供统一的检索接口：输入关键词，返回命中的知识条目与得分',
  'inv.generating': '正在生成示例…',
  'inv.testTitle': '在线检索测试',
  'inv.graphDesc': '返回命中的图谱实体与一跳关系',
  'inv.tripleDesc': '按关键词命中的三元组，按相关度排序',
  'inv.vectorDesc': '语义向量召回 + 关键词兜底',
  'inv.queryGraph': '例如：二级泵房',
  'inv.queryOther': '例如：设计流量 1200',
  'inv.needQuery': '请输入检索关键词',
  'inv.searchFailed': '检索失败',
  'inv.loadFailed': '加载调用示例失败',
  'inv.page': ' · 第 {n} 页',
  'inv.noHit': '没有命中知识',
  'inv.noHitHint': '换一个更具体的关键词，或确认该文件已完成抽取。',

  // ---------- 图谱 ----------
  'graph.zoomIn': '放大',
  'graph.zoomOut': '缩小',
  'graph.reset': '复位',
  'graph.truncated': '节点较多，仅展示关联度最高的一部分',
  'graph.related': '{n} 条关联 · 点击查看全部属性',
  'graph.closeDetail': '关闭详情',
  'graph.attributes': '属性（{n}）',
  'graph.relations': '关联（{n}）',
  'graph.sourceFiles': '来源文件 {n} 个',
  'graph.entity': '实体',
} as const

const en: Record<keyof typeof zh, Entry> = {
  // ---------- Common ----------
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saveChanges': 'Save changes',
  'common.delete': 'Delete',
  'common.clear': 'Clear',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.remove': 'Remove',
  'common.refresh': 'Refresh',
  'common.copy': 'Copy',
  'common.copyUrl': 'Copy URL',
  'common.copyCode': 'Copy code',
  'common.copied': 'Copied to clipboard',
  'common.copyFailed': 'Copy failed — please select the text manually',
  'common.test': 'Test connection',
  'common.hiddenSaved': 'Saved — leave blank to keep it',
  'common.notSet': 'Not set',
  'common.showHide': 'Show or hide',
  'common.failed': 'failed',
  'common.optional': 'Optional',
  'common.loading': 'Loading',
  'common.actionFailed': 'Something went wrong',
  'api.networkError': 'Cannot reach the server. Check that the backend is running.',
  'api.requestFailed': 'Request failed (HTTP {status})',

  // ---------- App ----------
  'app.notFoundTitle': 'Page not found',
  'app.notFoundHint': 'The address may have changed. Go back to your knowledge bases to start again.',
  'app.notFoundAction': 'Back to knowledge bases',
  'app.documentTitle': 'GrowKnow · Knowledge bases',
  'app.description': 'GrowKnow · Turn agents into domain experts',

  // ---------- Sidebar ----------
  'layout.openMenu': 'Open menu',
  'layout.closeMenu': 'Close menu',
  'layout.kbHeading': 'Knowledge bases',
  'layout.newKb': 'New knowledge base',
  'layout.noKb': 'No knowledge bases yet',
  'layout.createFirst': 'Create your first',
  'layout.pendingFiles': { one: '{n} file extracting', other: '{n} files extracting' },
  'layout.skills': 'Extraction skills',
  'layout.settings': 'Settings',
  'layout.footer': 'Vectors · triples · graphs, growing in one place',

  // ---------- Progress ----------
  'progress.queued': 'Queued',
  'progress.extracting': 'Extracting',
  'progress.waiting': 'Waiting for a worker',
  'progress.elapsed': 'Elapsed {time}',

  // ---------- Knowledge kinds ----------
  'kind.vector': 'Vector store',
  'kind.triple': 'Triple store',
  'kind.graph': 'Knowledge graph',
  'kind.vectorShort': 'Vectors',
  'kind.tripleShort': 'Triples',
  'kind.graphShort': 'Graph',
  'kind.targetTriple': 'Triple store',
  'kind.targetGraph': 'Knowledge graph',
  'kind.targetAny': 'Any',

  // ---------- File status ----------
  'status.queued': 'Queued',
  'status.extracting': 'Extracting',
  'status.ready': 'Ready',
  'status.failed': 'Failed',
  'status.canceled': 'Canceled',

  // ---------- KB list ----------
  'kbList.title': 'Knowledge bases',
  'kbList.desc':
    'One document, three knowledge forms: the vector store covers breadth, the triple store captures density, and the knowledge graph maps relationships.',
  'kbList.newKb': 'New knowledge base',
  'kbList.loading': 'Loading knowledge bases…',
  'kbList.emptyTitle': 'No knowledge bases yet',
  'kbList.emptyHint':
    'Upload a PDF or Word file and the platform will parse, chunk, and extract knowledge automatically. If this is your first knowledge base, start with a vector store.',
  'kbList.emptyAction': 'Create your first knowledge base',
  'kbList.noDesc': 'No description',
  'kbList.files': { one: '{n} file', other: '{n} files' },
  'kbList.knowledge': { one: '{n} item', other: '{n} items' },
  'kbList.entities': { one: '{n} entity', other: '{n} entities' },
  'kbList.filesUnit': { one: 'file', other: 'files' },
  'kbList.knowledgeUnit': { one: 'item', other: 'items' },
  'kbList.entitiesUnit': { one: 'entity', other: 'entities' },
  'kbList.pending': { one: '{n} extracting', other: '{n} extracting' },
  'kbList.updated': 'Updated {time}',

  // ---------- KB detail ----------
  'kbPage.loadFailed': 'Failed to load knowledge base',
  'kbPage.notOpenTitle': "Can't open this knowledge base",
  'kbPage.notOpenHint': 'It may have been deleted or its ID changed.',
  'kbPage.backToList': 'Back to knowledge bases',
  'kbPage.noDesc': 'No description yet. Add domain context in “Knowledge base settings”.',
  'kbPage.files': { one: '{n} file', other: '{n} files' },
  'kbPage.knowledge': { one: '{n} item', other: '{n} items' },
  'kbPage.filesUnit': { one: 'file', other: 'files' },
  'kbPage.knowledgeUnit': { one: 'item', other: 'items' },
  'kbPage.entitiesUnit': { one: 'entity', other: 'entities' },
  'kbPage.relationsUnit': { one: 'relation', other: 'relations' },
  'kbPage.entitiesRelations': '{nodes} entities · {edges} relations',
  'kbPage.extracting': 'Extraction in progress',
  'kbPage.updated': 'Updated {time}',
  'kbPage.manage': 'Manage',
  'kbPage.fileManager': 'Files',
  'kbPage.invocation': 'API usage',
  'kbPage.filesHeading': 'Files',
  'kbPage.filesSubtitle': { one: '{n} file · click to filter', other: '{n} files · click to filter' },
  'kbPage.downloadSelected': 'Download selected files',
  'kbPage.deleteSelected': 'Delete selected files and their knowledge',
  'kbPage.addFile': 'Add files',
  'kbPage.selectedOnly': { one: 'Showing {n} selected file', other: 'Showing {n} selected files' },
  'kbPage.noFiles': 'No files yet',
  'kbPage.uploadFile': 'Upload files',
  'kbPage.knowledgeCount': { one: '{n} item', other: '{n} items' },
  'kbPage.uploadedAt': 'Uploaded {time}',
  'kbPage.cancelExtraction': 'Cancel extraction',
  'kbPage.downloadOriginal': 'Download original',
  'kbPage.openFileManager': 'Open file manager · download / delete / retry',
  'kbPage.panelVector': 'Vector chunks',
  'kbPage.panelTriple': 'Triples',
  'kbPage.panelGraph': 'Knowledge graph',
  'kbPage.searchSummary': 'Search “{query}” · {n} matches',
  'kbPage.total': '{n} total',
  'kbPage.graphSummary': '{nodes} entities · {edges} relations',
  'kbPage.awaiting': 'Waiting for the first results',
  'kbPage.searchGraph': 'Search entities…',
  'kbPage.searchTriple': 'Search subject / predicate / object…',
  'kbPage.searchVector': 'Semantic search chunks…',
  'kbPage.search': 'Search',
  'kbPage.emptyUploadTitle': 'Upload your first file',
  'kbPage.emptyUploadHint':
    'Supports PDF / DOC / DOCX. The platform parses the layout, chunks pages at your setting, and extracts knowledge.',
  'kbPage.emptyUploadAction': 'Add files',
  'kbPage.reading': 'Loading knowledge…',
  'kbPage.graphBuilding': 'Graph is being built',
  'kbPage.graphEmpty': 'The graph is empty',
  'kbPage.graphBuildingHint': 'Files are being extracted. Entities and relations will appear here when done.',
  'kbPage.graphEmptyHint': 'Check the file status; retry failed files from the file manager.',
  'kbPage.notVectorized': 'Not embedded',
  'kbPage.notVectorizedHint': 'This chunk has no embedding yet; keyword search only',
  'kbPage.collapse': 'Collapse',
  'kbPage.expand': 'Show more',
  'kbPage.storedAt': 'Added {time}',
  'kbPage.chunksBuilding': 'Generating chunks',
  'kbPage.chunksEmpty': 'No chunks yet',
  'kbPage.chunksBuildingHint': 'Parsing and embedding in progress. Please wait a moment.',
  'kbPage.chunksEmptyHint': 'This knowledge base has no chunks yet.',
  'kbPage.triplesBuilding': 'Extracting triples',
  'kbPage.triplesEmpty': 'No triples yet',
  'kbPage.triplesBuildingHint': 'The extraction engine is reading the document chunk by chunk.',
  'kbPage.triplesEmptyHint': 'This knowledge base has no extraction results yet.',
  'kbPage.prev': 'Previous',
  'kbPage.next': 'Next',
  'kbPage.pageOf': 'Page {page} of {total}',
  'kbPage.page': 'Page {page}',
  'kbPage.deleteTitle': 'Delete files',
  'kbPage.deleteMessagePrefix': 'This will delete ',
  'kbPage.deleteMessageMiddle':
    ' files and all knowledge generated from them (chunks / triples / graph nodes). The original files will also be removed from the server. This cannot be undone.',
  'kbPage.searchGraphEmpty': 'No matching entities in the graph',
  'kbPage.searchGraphEmptyHint': "Try the entity's full name or another keyword.",
  'kbPage.clearSearch': 'Clear search',
  'kbPage.hitEntities': { one: '{n} entity matched — showing its neighborhood', other: '{n} entities matched — showing their neighborhood' },
  'kbPage.exitSearch': 'Exit search',
  'kbPage.noHit': 'No results',
  'kbPage.noHitHint': 'Try a more specific keyword, or make sure the files have finished extraction.',
  'kbPage.backToBrowse': 'Back to browsing',
  'kbPage.tripleHits': '{n} relevant triples ({mode})',
  'kbPage.modeKeyword': 'keyword match',
  'kbPage.modeHybrid': 'hybrid ranking',
  'kbPage.chunkHits': '{n} relevant chunks · {mode}',
  'kbPage.modeVector': 'semantic recall',
  'kbPage.modeMixed': 'semantic + keyword',
  'kbPage.modeFallback': 'keyword fallback',

  // ---------- New KB ----------
  'newKb.back': 'Back',
  'newKb.title': 'New knowledge base',
  'newKb.desc': 'Choose the knowledge form that best fits your content',
  'newKb.name': 'Name',
  'newKb.editableAfterCreate': 'Required; editable after creation',
  'newKb.namePlaceholder': 'e.g. Lab equipment manual',
  'newKb.nameHelp': 'Supports letters, Chinese, digits, and symbols',
  'newKb.id': 'Knowledge base ID',
  'newKb.idHelp': 'Only letters, digits, - and _. API calls use this ID.',
  'newKb.description': 'Description',
  'newKb.optionalEditable': 'Optional; editable after creation',
  'newKb.descriptionPlaceholder':
    'What this knowledge base contains and who it is for. The description is used as domain context during extraction.',
  'newKb.kind': 'Knowledge form',
  'newKb.kindFixed': 'Required; cannot be changed after creation',
  'newKb.vectorTitle': 'Vector store',
  'newKb.vectorTagline': 'Chunks stored as embeddings',
  'newKb.vectorPros': 'Fastest to build; works for almost any kind of content',
  'newKb.vectorCons': 'Lower knowledge density and recall precision',
  'newKb.tripleTitle': 'Triple store',
  'newKb.tripleTagline': 'Subject–predicate–object',
  'newKb.triplePros': 'High knowledge density; efficient and precise retrieval',
  'newKb.tripleCons': 'Narrower fit; best for clear, factual statements',
  'newKb.graphTitle': 'Knowledge graph',
  'newKb.graphTagline': 'Node–relation–node',
  'newKb.graphPros': 'Captures relationships between facts; most extensible',
  'newKb.graphCons': 'Slowest to build; higher curation and maintenance cost',
  'newKb.nameRequired': 'Please enter a name',
  'newKb.idInvalid':
    'ID must start with a letter or digit, contain only letters, digits, - and _, and be 2–64 characters',
  'newKb.created': 'Knowledge base created',
  'newKb.create': 'Create knowledge base',

  // ---------- Settings ----------
  'settings.loading': 'Loading settings…',
  'settings.loadFailed': 'Failed to load settings',
  'settings.depsFailed': 'Failed to load service status',
  'settings.title': 'Settings',
  'settings.desc': 'Model settings apply to new tasks as soon as they are saved.',
  'settings.save': 'Save settings',
  'settings.saveFailed': 'Failed to save',
  'settings.savedHot': 'Settings saved and the extraction engine is in sync',
  'settings.savedNoHot': 'Settings saved, but the extraction engine could not hot-reload: {reason}',
  'settings.testOk': 'Connected ({ms} ms)',
  'settings.testOkLabel': '{label} connected',
  'settings.testFailLabel': '{label} connection failed',
  'settings.testFailed': 'Connection failed',
  'settings.embDims': '{model} · {dims} dims',
  'settings.providerReady': 'provider registered',
  'settings.providerMissing': 'provider not registered',
  'settings.llmTitle': 'LLM',
  'settings.llmDesc': 'Used for triple and graph extraction',
  'settings.baseUrl': 'Base URL',
  'settings.baseUrlHint': 'OpenAI-compatible base URL, usually ending in /v1',
  'settings.model': 'Model',
  'settings.apiKey': 'API Key',
  'settings.embTitle': 'Embedding service',
  'settings.embDesc': 'Embeds chunks for the vector store',
  'settings.embFallbackNow': 'Currently reusing the LLM config',
  'settings.embBaseHint':
    'OpenAI-compatible base URL. Leave blank to reuse the LLM base URL and API key.',
  'settings.embBasePlaceholder': 'Leave blank to reuse the LLM base URL',
  'settings.embKeyPlaceholder': 'Leave blank to reuse the LLM API key',
  'settings.mineruTitle': 'MinerU layout parsing',
  'settings.mineruDesc': 'Layout parsing and content extraction for PDF, DOC, XLS, images, and more',
  'settings.service': 'Service',
  'settings.mineruAgent': 'Official lightweight API · free, no sign-up',
  'settings.mineruPrecision': 'Official precision API · account and token required',
  'settings.mineruSelfhost': 'Self-hosted API · requires your own MinerU',
  'settings.mineruAgentHint':
    "Uses MinerU's official lightweight API. Free and no sign-up. Rate-limited; max 10 MB / 20 pages per file; no page numbers.",
  'settings.mineruToken': 'API Token',
  'settings.mineruTokenHint': 'Request one in the mineru.net console',
  'settings.mineruTokenPlaceholder': 'Enter your MinerU API token',
  'settings.mineruPrecisionHint':
    "Uses MinerU's official precision API. Max 200 MB / 200 pages per file; includes page numbers. Get a token at https://mineru.net/apiManage/token",
  'settings.tier': 'Parsing tier',
  'settings.tierFlash': 'flash · for simple layouts',
  'settings.tierStandard': 'standard · for complex formulas and tables',
  'settings.tierAdvanced': 'advanced · highest fidelity',
  'settings.selfhostHint': 'Requires a local MinerU deployment.',
  'settings.statusTitle': 'Service status',
  'settings.statusDesc': 'Internal services are connected automatically by the platform.',
  'settings.statusDescAt': 'Internal services are connected automatically by the platform · checked at {time}.',
  'settings.recheck': 'Check again',
  'settings.running': 'Running',
  'settings.checking': 'Checking…',
  'settings.opencodeUrl': 'opencode URL: ',
  'settings.opencodeEngine': 'opencode engine',
  'settings.checkEngine': 'Test engine',
  'settings.languageTitle': 'Language',
  'settings.languageDesc': 'Follows your browser by default; you can also choose manually below.',
  'settings.languageAuto': 'Auto (browser)',
  'settings.languageZh': '简体中文',
  'settings.languageEn': 'English',

  // ---------- Skills ----------
  'skills.loading': 'Loading skills…',
  'skills.loadFailed': 'Failed to load skills',
  'skills.title': 'Extraction skills',
  'skills.desc':
    'An extraction skill is a skill.md for the extraction engine: it defines what to extract and how to phrase it. Changes apply to the next extraction and do not affect existing knowledge.',
  'skills.new': 'New skill',
  'skills.emptyList': 'No skills yet',
  'skills.builtin': 'Built-in',
  'skills.filesUsing': { one: 'used by {n} file', other: 'used by {n} files' },
  'skills.selectTitle': 'Select or create a skill',
  'skills.selectHint':
    'A skill determines what knowledge is extracted. The built-in triple and graph skills work out of the box and can be copied and adapted.',
  'skills.editTitle': 'Edit skill',
  'skills.createTitle': 'New skill',
  'skills.lastUpdated': 'Last updated {time}',
  'skills.fillFirst': 'Fill in a name and slug, then save',
  'skills.unsaved': 'Unsaved',
  'skills.name': 'Name',
  'skills.namePlaceholder': 'e.g. Legal clause extraction',
  'skills.slug': 'Slug',
  'skills.slugHint': 'lowercase letters, digits, and -',
  'skills.target': 'Applies to',
  'skills.description': 'Summary',
  'skills.descriptionPlaceholder': 'One sentence on when to use it',
  'skills.content': 'skill.md content',
  'skills.contentHint':
    'The JSON output contract is appended automatically; do not repeat it here',
  'skills.chars': '{n} characters · describe scope, quality rules, and examples',
  'skills.builtinHint': 'This is a built-in skill. You can edit its content, but it cannot be deleted.',
  'skills.deleteTitle': 'Delete skill “{name}”',
  'skills.deleteMessage':
    'Knowledge already extracted with this skill is kept, but it can no longer be used for new files.',
  'skills.errorEmpty': 'Name, slug, and content are required',
  'skills.created': 'Skill created; applies to the next extraction',
  'skills.saved': 'Skill saved; applies to the next extraction',
  'skills.deleted': 'Skill deleted',
  'skills.saveFailed': 'Failed to save',
  'skills.deleteFailed': 'Failed to delete',
  'skills.builtinGenericTriple': 'General triple extraction',
  'skills.builtinLegalTriple': 'Legal clause extraction',
  'skills.builtinGenericGraph': 'General knowledge graph extraction',

  // ---------- Upload ----------
  'upload.title': 'Add files',
  'upload.subtitle': 'Upload to “{name}”. Parsing and extraction run in the background.',
  'upload.filesSelected': { one: '{n} file · {size}', other: '{n} files · {size}' },
  'upload.supports': 'Supports PDF / DOC / DOCX',
  'upload.start': 'Start extraction',
  'upload.dropTitle': 'Drag files here, or click to browse',
  'upload.dropHint': 'Select multiple PDF / DOC / DOCX files; max 100 MB each',
  'upload.skipUnsupported': 'Skipped unsupported files: {names}',
  'upload.overSize': '{name} (over 100 MB)',
  'upload.chooseFirst': 'Please choose files first',
  'upload.chooseSkill': 'Please choose an extraction skill',
  'upload.queued': { one: 'Uploaded {n} file; extraction queued', other: 'Uploaded {n} files; extraction queued' },
  'upload.failed': 'Upload failed. Please try again.',
  'upload.pages': 'Pages per chunk',
  'upload.pagesHint': 'About N pages per chunk; breaks early at section headings',
  'upload.decrease': 'Decrease',
  'upload.increase': 'Increase',
  'upload.skill': 'Extraction skill',
  'upload.vectorHint':
    'Vector stores embed chunks directly and keep the full text; no extraction skill is needed.',
  'upload.skillHint': 'Defines what knowledge is extracted and at what granularity',

  // ---------- File manager ----------
  'fm.title': 'File manager',
  'fm.subtitle':
    '{name} · {n} files (ready {ready} / running {running} / failed {failed}{canceled})',
  'fm.canceledPart': ' / canceled {n}',
  'fm.selected': { one: '{n} file selected', other: '{n} files selected' },
  'fm.deleteNote': 'Deleting files also deletes the knowledge they produced',
  'fm.batchDownload': 'Download',
  'fm.deleteSelected': 'Delete selected',
  'fm.upload': 'Upload files',
  'fm.emptyTitle': 'No files yet',
  'fm.emptyHint':
    'Upload PDF / DOC / DOCX files; the platform parses layouts, chunks pages, and extracts knowledge.',
  'fm.fileName': 'File',
  'fm.uploaded': 'Uploaded',
  'fm.status': 'Status',
  'fm.knowledge': 'Knowledge',
  'fm.actions': 'Actions',
  'fm.selectAll': 'Select all',
  'fm.selectFile': 'Select {name}',
  'fm.pages': { one: '{n} page', other: '{n} pages' },
  'fm.retry': 'Retry extraction',
  'fm.retrySuccess': 'Extraction re-queued',
  'fm.retryFailed': 'Retry failed',
  'fm.cancelSuccess': 'Cancellation requested',
  'fm.cancelFailed': 'Failed to cancel',
  'fm.deleteSuccess': { one: 'Deleted {n} file and its knowledge', other: 'Deleted {n} files and their knowledge' },
  'fm.deleteFailed': 'Failed to delete',
  'fm.deleteTitle': 'Delete files',
  'fm.deleteMessagePrefix': 'This will delete ',
  'fm.deleteMessageMiddle':
    ' files and all knowledge generated from them (chunks / triples / graph nodes). The original files will also be removed from the server. This cannot be undone.',

  // ---------- KB settings ----------
  'kbSet.title': 'Knowledge base settings',
  'kbSet.name': 'Name',
  'kbSet.nameHint': 'Letters, Chinese, digits, and symbols',
  'kbSet.id': 'Knowledge base ID',
  'kbSet.idHint': 'Only letters, digits, - and _',
  'kbSet.description': 'Description',
  'kbSet.idWarning':
    'Changing the ID changes the API URL (the old one stops working immediately). Existing knowledge is kept and migrated.',
  'kbSet.nameRequired': 'Name is required',
  'kbSet.idInvalid':
    'ID must start with a letter or digit, contain only letters, digits, - and _, and be 2–64 characters',
  'kbSet.updated': 'Knowledge base updated',
  'kbSet.deleted': 'Knowledge base deleted',
  'kbSet.saveFailed': 'Failed to save',
  'kbSet.deleteFailed': 'Failed to delete',
  'kbSet.dangerTitle': 'Delete knowledge base',
  'kbSet.dangerDesc': 'Deletes all files, chunks, triples, and graph data. This cannot be undone.',
  'kbSet.delete': 'Delete knowledge base',
  'kbSet.confirmTitle': 'Delete “{name}”',
  'kbSet.confirmPrefix': 'This knowledge base has ',
  'kbSet.confirmMiddle': ' files and ',
  'kbSet.confirmSuffix':
    ' knowledge items. They will be permanently deleted, and the original files will be removed from the server. This cannot be undone.',

  // ---------- API usage ----------
  'inv.title': 'API usage',
  'inv.subtitle':
    '“{name}” exposes one search API: send a query and get matching knowledge with scores.',
  'inv.generating': 'Generating example…',
  'inv.testTitle': 'Live search test',
  'inv.graphDesc': 'Returns matched entities and one-hop relations',
  'inv.tripleDesc': 'Keyword-matched triples ranked by relevance',
  'inv.vectorDesc': 'Semantic recall with keyword fallback',
  'inv.queryGraph': 'e.g. Secondary pump house',
  'inv.queryOther': 'e.g. Design flow 1200',
  'inv.needQuery': 'Please enter a query',
  'inv.searchFailed': 'Search failed',
  'inv.loadFailed': 'Failed to load examples',
  'inv.page': ' · page {n}',
  'inv.noHit': 'No results',
  'inv.noHitHint': 'Try a more specific keyword, or make sure the file has finished extraction.',

  // ---------- Graph ----------
  'graph.zoomIn': 'Zoom in',
  'graph.zoomOut': 'Zoom out',
  'graph.reset': 'Reset view',
  'graph.truncated': 'Many nodes — showing only the most connected ones',
  'graph.related': { one: '{n} link · click to view all attributes', other: '{n} links · click to view all attributes' },
  'graph.closeDetail': 'Close details',
  'graph.attributes': 'Attributes ({n})',
  'graph.relations': 'Relations ({n})',
  'graph.sourceFiles': { one: '{n} source file', other: '{n} source files' },
  'graph.entity': 'Entity',
}

export type TKey = keyof typeof zh
export type TFunction = (key: TKey, vars?: Record<string, string | number>) => string

function systemLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh'
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return languages.some((item) => String(item).toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

function readPref(): LangPref {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'auto' || saved === 'zh' || saved === 'en') return saved
  } catch {
    // 隐私模式下 localStorage 可能不可用，直接跟随浏览器
  }
  return 'auto'
}

/** 当前生效语言；供 API 层读取 Accept-Language。 */
export function currentLang(): Lang {
  const pref = readPref()
  return pref === 'auto' ? systemLang() : pref
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (_match, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  )
}

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const entry: Entry = (lang === 'zh' ? zh[key] : en[key]) as Entry
  const text = typeof entry === 'string' ? entry : Number(vars?.n) === 1 ? entry.one : entry.other
  return interpolate(text, vars)
}

const STAGE_EN: Record<string, string> = {
  排队中: 'Queued',
  '取消中…': 'Canceling…',
  已取消: 'Canceled',
  解析文档: 'Parsing document',
  整理切片: 'Preparing chunks',
  整理结果: 'Curating results',
  完成: 'Done',
  抽取失败: 'Extraction failed',
  写入向量: 'Writing vectors',
}

/** 后端把阶段文案直接落库，这里做展示层翻译；未知阶段原样显示。 */
export function stageLabel(stage: string, lang: Lang): string {
  if (!stage || lang === 'zh') return stage
  if (STAGE_EN[stage]) return STAGE_EN[stage]
  let match = stage.match(/^已完成 (\d+)\/(\d+) 段$/)
  if (match) return `Completed ${match[1]}/${match[2]} segments`
  match = stage.match(/^抽取第 (\d+)\/(\d+) 段$/)
  if (match) return `Extracting segment ${match[1]}/${match[2]}`
  match = stage.match(/^向量化 (\d+)\/(\d+) 批$/)
  if (match) return `Embedding batch ${match[1]}/${match[2]}`
  match = stage.match(/^向量化（共 (\d+) 批）$/)
  if (match) return `Embedding (${match[1]} batch${match[1] === '1' ? '' : 'es'})`
  match = stage.match(/^完成（跳过 (\d+) 段）$/)
  if (match) return `Done (${match[1]} segment${match[1] === '1' ? '' : 's'} skipped)`
  return stage
}

export function kindLabel(kind: KbKind, lang: Lang): string {
  return translate(lang, `kind.${kind}` as TKey)
}

export function kindShortLabel(kind: KbKind, lang: Lang): string {
  return translate(lang, `kind.${kind}Short` as TKey)
}

export function statusLabel(status: FileStatus | string, lang: Lang): string {
  const key = `status.${status}` as TKey
  return key in zh ? translate(lang, key) : status
}

/** 内置 skill 的展示名随界面语言切换；用户自建 skill 原样显示。 */
export function skillDisplayName(skill: Pick<Skill, 'slug' | 'name' | 'builtin'>, lang: Lang): string {
  if (!skill.builtin) return skill.name
  const key =
    skill.slug === 'generic-triple'
      ? 'skills.builtinGenericTriple'
      : skill.slug === 'legal-triple'
        ? 'skills.builtinLegalTriple'
        : skill.slug === 'generic-graph'
          ? 'skills.builtinGenericGraph'
          : null
  return key ? translate(lang, key) : skill.name
}

export function formatDuration(seconds: number, lang: Lang): string {
  const total = Math.max(0, Math.floor(seconds))
  if (lang === 'en') {
    if (total < 60) return `${total}s`
    const minutes = Math.floor(total / 60)
    if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  }
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分 ${String(total % 60).padStart(2, '0')} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${String(minutes % 60).padStart(2, '0')} 分`
}

interface I18nValue {
  lang: Lang
  pref: LangPref
  setPref: (pref: LangPref) => void
  t: TFunction
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(readPref)
  const [system, setSystem] = useState<Lang>(systemLang)

  useEffect(() => {
    const onChange = () => setSystem(systemLang())
    window.addEventListener('languagechange', onChange)
    return () => window.removeEventListener('languagechange', onChange)
  }, [])

  const lang = pref === 'auto' ? system : pref

  const setPref = useCallback((next: LangPref) => {
    setPrefState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 忽略存储失败，本次会话内仍然生效
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = translate(lang, 'app.documentTitle')
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', translate(lang, 'app.description'))
  }, [lang])

  const t = useCallback<TFunction>((key, vars) => translate(lang, key, vars), [lang])

  const value = useMemo(() => ({ lang, pref, setPref, t }), [lang, pref, setPref, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('I18nProvider missing')
  return value
}
