# Aker — 批评与回应（CRITICISMS）

这份文档逐条记录评审会对 Aker 的全部 ranked 批评，以及我们的回应。
每条格式为：**批评 → 我们的回应**，回应标注为以下三态之一：

- ✅ **已修复** —— 本轮已落地代码 / 文案改动。
- ⚖️ **设计取舍** —— 现状是有意为之，说明取舍理由，本轮不改行为。
- 🗺️ **暂不做（路线图）** —— 承认问题成立但属较大工程，给出理由与未来方向。

> 一句话定位（先说在前面）：**Aker 的 Sim 模式只是演示评审管线；Live 模式才用于真实结论。**
> Sim 模式下被评审的 agent 输出与 trace 都是确定性模板 + 伪随机生成的**占位数据**；真实的只有跑在这些占位数据上的聚类 / 交并集 / 归因算法。要得到对真实模型有意义的结论，必须用 Live 模式。v0.2 已接通 Codex CLI 的真实 JSONL 事件流；其他框架级逐步 trace 仍在路线图上。下面所有诚实性条目都围绕「让这件事在界面上无法被忽视」展开。

## v0.2 状态更新（2026-06-08）

- ✅ 已接通 Codex CLI：自动检测本机登录态，通过 `codex exec --json` 获取真实回答、事件和 token。
- ✅ Live 失败不再静默降级到 Sim；失败会明确显示，避免模拟结果混入真实评审。
- ✅ 多个真实评审完成后，会调用真实 Live 通道生成一次“评审团主席综合”，产出可执行最终方案。
- ✅ 首页新增首次使用路径、真实通道状态和评审角色，`npm test` / `npm run check` 可直接验收。
- ⚠️ Codex CLI 已有真实 JSONL trace；Anthropic/OpenAI 直连仍只有最终响应 + usage。语义聚类、逐条证据归因仍是路线图。

---

## 诚实性（honesty）

### H1 — Sim 卡片无「模拟数据」标记，指标与 Live 同款呈现 · critical · ✅ 已修复
**批评**：`agentCard()` 仅在 `mode==='live'` 加 pill，sim 卡片没有任何「模拟 / 示意」标记；token / 耗时 / 步骤等精确数字（来自 `composeTrace` 的伪随机）与真实测量无法区分，侧栏角落的「Sim 模式」极易忽略。
**回应（✅ frontend）**：在 `agentCard()` 给 sim 卡片强制加一个告警色徽章「SIMULATED · 模板数据」，并对 token / 步骤 / 耗时等指标加 `~` 前缀 + `title="模拟值，非真实测量"`、弱化为灰色。降级到 sim 的 agent（见 H7）同样套用此标记。改动仅在 `web/app.js` 渲染分支与 `styles.css` 的 `.pill.sim` 样式，不动 API / 选择器。

### H2 — 虚构 trace 仍打「原生结构化 / native」最高可信度徽章 · critical · ✅ 已修复
**批评**：`runSim` 的 `trace.source` 复用框架图鉴的 `traceability`（native / otel / cli-log），UI 渲染成「trace: 原生结构化」，但 sim 下根本没有 jsonl / transcript，step 全是 `composeTrace` 拼的，冒充了「本次实际拿到的 trace 等级」。
**回应（✅ backend）**：`runSim` 的 `traceSource` 在 sim 路径返回固定的 `{traceability:'sim', how:'composeTrace 模板生成，非真实采集'}`，并在 `frameworks.TRACEABILITY_META` 增加 `sim` 档（告警色徽章，score 0）。只有 Live 真读到 usage / transcript 时才标 native / otel / cli-log。

### H3 / P5 — README 宣称 Sim「非假数据」，与模板 / 随机造数据矛盾 · high / medium · ✅ 已修复
**批评**：`README.md:9`、`build-standalone.mjs` 注释、`committee.mjs:4` 都写「真实计算 / 非假数据」。真实的只有聚类算法，被评审的 agent 输出与 trace 是 `composeOutput` 模板 + `composeTrace` 伪随机造的。「对假数据做真实计算」不等于「非假数据」。怀疑型用户读到「非假数据」再发现三段输出前三条逐字相同，会贴「夸大宣传」标签。（P5 与 H3 是同一句 README，合并处理。）
**回应（✅ docs_tests + 协调）**：删除所有「非假数据」字样，README 改写为诚实表述：Sim 用确定性模板生成差异化占位输出与模拟 trace（token / 耗时为示意值），聚类 / 交并集是对占位数据做的真实算法计算；真实结论需 Live。同步改 `committee.mjs:4` 注释与 `build-standalone.mjs:63` 注释（分别由 committee / backend 工作流落地）。本条记录由 docs_tests 统筹。

### H4 — 差异归因把模板随机数当真实「推理深度 / 工具差异」证据，伪因果 · high · ✅ 已修复
**批评**：`attribute()` 与 cred 打分基于 trace 的步数 / 工具 / token，但 sim 下这些来自 `FRAMEWORK_TOOLKIT` 静态表 + 随机 + 硬编码 if，与模型是否真自我验证无关；界面无「基于模拟 trace」免责，把假数字加工成看似可信的判断。
**回应（✅ frontend）**：评审会渲染顶部，当所选 `run.mode==='sim'`（或含降级 agent）时固定显示告警 banner：「本次评审基于模拟 trace，归因仅演示算法形态，不代表真实模型行为」。纯展示层，不改算法、不破坏 API。更深的逐条归因重构见 A4。

### H5 — 分歧点 UI 写「可能是幻觉 / 无依据发挥」，但模板输出不可能幻觉 · medium · ✅ 已修复
**批评**：divergence 文案「可能是独到洞见，也可能是无依据发挥 / 幻觉」，但 sim 下独有要点是 `composeOutput` 的固定模板句，既非洞见也非幻觉，邀请用户对假数据做真伪判断。
**回应（✅ frontend，部分成立）**：与 H4 同源，由同一条 sim 告警 banner 覆盖。此外 sim 模式下把分歧点 section-hint 改为中性「以下分歧来自模板的固定差异化句式」，仅 Live 保留「洞见 / 幻觉」话术。

### H6 — GitHub Pages 在线版永远 Sim，但首页不告知，Live 按钮静默降级 · high · ✅ 已修复
**批评**：`docs/index.html` 浏览器内 `__ENV` 永远拿不到 key，`health.live` 恒 false，Live 按钮点了只降级；README 把它当「在线体验」推，用户以为在线真调了模型。
**回应（✅ frontend + docs_tests）**：与 U1 合并 —— `health.live=false` 时禁用 Live 按钮并给明确 title。README「在线体验」旁已加注「在线版永远是 Sim，不会真的调用任何模型」（docs_tests 在 H3 同一改动里落地）。

### H7 — Live 降级到 Sim 时仅一行琥珀小字，假指标照常以真实面貌呈现 · medium · ✅ 已修复
**批评**：`runAgent` 静默降级，卡片仅一行 amber note，下方照常显示 token / 耗时 / native 徽章，用户易只看指标忽略小字。
**回应（✅ frontend）**：与 H1 合并 —— 降级后的 agent 其 mode 仍是 `'sim'`，H1 的 SIMULATED 徽章 + `~` 指标 + H2 的 sim trace 徽章自动套用，且 note 升级为卡片级 banner 样式（告警色边框），不再只是脚注小字。

### P1 — Sim 核心闭环是自证循环：评审分析的是模板自己拼的字符串 · critical · ✅ 已修复（文案 + 文档）
**批评**：Sim 下 `composeOutput` 前 3 条要点对所有 agent 逐字相同、4 / 5 条查表填，committee 必然把前 3 聚成共识、4 / 5 判分歧 —— 不是发现真实共识 / 分歧，而是把自己写死的模板结构又解析一遍，换任何 task 结构一样。
**回应（✅ 组合落地 + 🗺️ 真 demo）**：这是 Sim 定位的根本诚实性问题，与 H3 / H4 / A1 同根。本轮的诚实化组合共同回应：H1 卡片标记 + H4 评审 banner + H3 README 改写 + A1 文案标注，明确告诉用户 **Sim 的共识 / 分歧来自固定模板、仅演示算法管线、不代表真实模型**。`test/committee.cluster.test.mjs` 第 2 个用例把「逐字相同 → 聚成共识」这一自证循环的根因钉成回归断言。
**🗺️ 路线图**：「真 demo」—— 把 Sim 跑在真实导出的语料上（例如几段真实模型对同一 task 的输出），让评审会分析真实文本而非模板字符串。这属较大工程（需要一套离线语料 + 导入流程），记为路线图。

### P3 — 过程可信度加权是循环论证：cred 来自 Sim 查表 trace · high · ✅ 已修复（文案）
**批评**：`cred = tools*2 + min(steps,6) - errors*3`，Sim 下 tools / steps 全由 `FRAMEWORK_TOOLKIT` 查表 + rng 造，errors 恒 0，「谁的洞见被采纳」纯由框架表预定，却包装成可信度评分。
**回应（✅ committee + 🗺️）**：本轮不在 Sim 下删除加权（会动核心展示），而是在 H4 的 sim 告警 banner 中明确「可信度基于模拟 trace，无事实依据」，并在 `synthesizeBetter` 采纳行文案加 Sim 条件标注（随 A3 / A6 改）。**真正的可信度需 Live 真实工具调用**，记为路线图。

---

## 算法 / 完整性（algorithm / completeness / correctness）

### A1 — 中文要点聚类不可靠：同义改写不聚合，共识 / 分歧系统性误报 · critical · 🗺️ 路线图（本轮：文档 + 回归测试 + 文案）
**批评**：`clusterPoints` 用 CJK 单字 + bigram jaccard，中文同义改写词面几乎不重叠，实测两条同义句返回 `consensus:0 divergent:2`。Sim 之所以「看起来能用」是因为 `composeOutput` 让共识要点逐字相同，作弊掩盖了缺陷；换 Live 真实措辞共识会塌成 0。
**回应（已复现 consensus 0）**：这是产品价值主张的核心算法缺陷。「真正的语义聚类」需 embedding，属大改。本轮做三件低风险事：
1. ✅ **回归测试固定缺陷边界** —— `test/committee.cluster.test.mjs` 第 3 个用例断言「同义句当前不聚合（0 共识 / 2 分歧）」；未来换 embedding 后此断言会变红，提示把期望翻转为 `consensus>=1`。
2. ✅ **README / UI 文案标注** —— README 已写明「聚类是字面相似度（Jaccard），不是语义聚类；Live 措辞多样时共识可能偏低」；UI 文案随 H4 banner 出。
3. 🗺️ **embedding 语义聚类** —— 记为 Live roadmap，本轮不实现（零依赖约束下接 embedding 需要外部服务或本地模型，是独立工程）。

### A2 — 评审核心全靠裸魔法数字，未标定不可解释 · high · ✅ 已修复（命名 + 注释）+ 🗺️
**批评**：`SIM_THRESHOLD=0.34`、`majority=max(2,ceil(n/2))`、深度触发 `maxS-minS>=2`、cred 公式全是无注释硬编码常数；centroid 增量膨胀导致顺序依赖、非确定性；sim 下 tools 由框架表决定，等于框架配置预定了谁更可信。
**回应（✅ committee + 🗺️）**：把这些常数提为 `committee.mjs` 顶部命名 `CONFIG`（带注释说明取值理由与「仅启发式 / Sim 演示用」声明），并在 README 标注「Sim 可信度由框架工具表驱动，非真实质量」。
**🗺️ 路线图**：centroid 增量膨胀带来的**顺序依赖与阈值敏感度**是真实的算法稳健性问题（同一组要点换输入顺序可能聚出不同簇）。修法是改用固定锚点 / 不可变 centroid 或一次性层次聚类 + 阈值敏感度自检，属算法重构，记为路线图。

### A3 — 代码与 UI 承诺的 Live LLM 综合 `adapters.liveSynthesize` 根本不存在 · high · ✅ v0.2 已实现
**批评**：`committee.mjs:5` 与 `:196` 文案承诺 Live 下 `synthesizeBetter` 被 LLM 综合替换（`adapters.liveSynthesize`），但全仓库无该 export，review 永远走规则版，即使配 key 也无 LLM 二次综合。产品输出印着不存在的能力。
**回应（✅ committee + 🗺️）**：已确认 `liveSynthesize` 不存在。本轮删除 / 改写 `committee.mjs:5` 注释与 `:196` 对用户的承诺文案，改为「当前为规则式综合（启发式，仅演示）；Live LLM 综合为 roadmap」。
**v0.2 更新**：已实现 `synthesizeReview`。本地 server 对包含至少两个真实评审的 Live run 调用可用 Live 通道做二次综合，并缓存结果，避免重复消耗。

### A4 — 差异归因把「模型 / 步骤不同」当归因，实为配置常量复述 · high · 🗺️ 路线图（本轮：文案降级）
**批评**：`attribute()` 的模型差异 / 工具差异 / 推理深度差异只复述 run 配置（`models.length>1` 无条件输出 high），与具体哪条要点分歧无因果联系；divergence 参数只用于计数，没有单条要点到 trace step 的归因。
**回应（✅ 文案 + 🗺️）**：本轮配合 A2 把「模型差异」这类降级为「配置级信息，非逐条归因」措辞（在 committee 的 detail 文案里说明）。
**🗺️ 路线图 —— 逐条归因设计草案**：把每条 divergence 连到具体 trace 证据。设计方向：
- 对每条 divergent 要点，提取其关键 token / 实体；
- 在提出该要点的 agent 的 trace step 里检索与这些 token 相关的 tool / observe step（例如某条独有结论由某次 `retriever` / `web_search` 的 observe 支撑）；
- 输出「要点 X ← 由 agent A 的第 k 步 `tool=web_search` 提供事实支撑」这种逐条映射，替代当前的「配置级笼统归因」。
在 Sim 单步 / 模板 trace 下证据有限，此功能依赖 A8 的真实多步 trace 落地，故记为 committee + Live 联合路线图。

### A5 — trace 效果评审只有计数级指标，无过程质量；errors 恒 0 致 `-errors*3` 为死代码 · high · 🗺️ 路线图（本轮：error step + 注释）
**批评**：`summarizeTrace` / `diffTraces` 全是计数求和，无成功率 / 重试 / 冗余步骤 / 目标达成等质量指标；`composeTrace` 与 Live 都从不产 error step，故 errors 恒 0，cred 公式的 `-errors*3` 永不触发。
**回应（✅ 部分 + 🗺️）**：本轮两件可控小修：
1. ✅ 让 Live 的 `callAnthropic` / `callOpenAI` 在 resp 非 2xx / `tool_result.is_error` 时生成 `type:'error'` step（与 C3 的 `resp.ok` 检查同改），让 `-errors*3` 在 Live 下真正可触发。
2. ✅ committee 在 A2 的注释里标注「cred 公式当前在 Sim 下 errors 恒 0」。
**🗺️ 路线图 —— 过程质量指标体系**：成功率（done / 总 step）、重试率（同一 tool 连续失败后重调）、冗余步骤（无信息增益的 observe）、目标达成（最终 message 是否覆盖 task 关键约束）。这些需要在 trace 里携带更多语义，属大工程，记为路线图。

### A6 — consensus 用「多数即正确」，无防同源 / 相关性失败机制 · medium · ✅ 已修复（文案）+ 🗺️
**批评**：consensus 直接标「多数 agent 一致，可信度最高」，但同基座模型会相关性一起错；aker 允许同模型多 agent 却无按 vendor 去相关或降权。
**回应（✅ committee + 🗺️）**：本轮把 `synthesizeBetter` 文案的绝对化「可信度最高」改为「多数 agent 覆盖（同源模型需警惕共同偏见，非绝对可信）」。
**🗺️ 路线图**：完整的独立性加权 —— 按 vendor / 基座模型对 agent 分组，组内相关性降权，跨独立来源的一致才给高可信。属算法重构，记为路线图。

### A7 — `mode` 参数（intersection / union）只换标签，`review()` 计算完全相同 · low · ⚖️ 设计取舍
**批评**：`review(run, mode)` 接收 mode 但函数体除写回外不读，intersection 与 union 负载逐字相同，前端纯展示层切换，API 暗示不存在的服务端语义。
**回应（⚖️ 有意取舍，无害）**：交集（共识）与并集（全集）本就是**同一聚类的两种视图**：后端一次性算出全部簇，`consensus` 与 `union` 同时返回，前端切换 mode 只是选择展示哪一份，零冗余、零重复计算。`review()` 把 mode 原样回写仅用于标注当前视图。本轮不改行为，仅在 committee 注释里点明「mode 仅用于标注返回视图，避免误读为服务端有不同计算路径」。
> 注意：硬性要求 `review()` 签名不变，本条不动签名。

### A8 — Live trace 仅单条 message step，真实模式下 trace 评审退化为零 · high · ✅ Codex CLI 已实现 + 🗺️ 其他通道
**批评**：`callAnthropic` / `callOpenAI` 只塞一条 `makeStep` message，无 think / tool / observe，Live 下工具差异 / 推理深度归因恒空，反而 Sim 因造假 trace「更像在评审过程」。README 表格把可得性吹得很全，代码一个都没接。
**回应（✅ docs_tests + 🗺️）**：本轮 README 的 trace 可得性表已加注「上表是可行性分级，不是已实现状态；当前 Live 实现仅消费最终响应 + usage，逐步 trace 为路线图」，不让表格暗示已实现。
**v0.2 更新**：Codex CLI 已通过 `codex exec --json` 接通真实事件流、错误和 usage。其余通道按可得性分档逐个接通：
- 原生结构化：读 Claude Agent SDK 的 trace 对象 / Codex 的 `~/.codex/sessions` jsonl transcript，归一成多步 step；
- OTel：接 OpenTelemetry exporter，把 span 转 step；
- CLI 日志：解析 `--json` 事件流。
接通任意一档后，A4（逐条归因）与 A5（过程质量）才有真实证据可用。这是 Aker 最有价值的窄场景方向（见 P4）。

### C3 — Live 调用从不检查 `resp.ok`：401 / 429 / 5xx 被当成功 · high · ✅ 已修复
**批评**：`callAnthropic` / `callOpenAI` 拿到 resp 直接取 `j.content` / `j.choices`，不检查 `resp.ok`；key 失效 / 限流 / 错误时取值得空串，仍 `return status:done mode:live`，空输出污染评审聚类，`runAgent` catch 救不到（未抛错）。
**回应（✅ backend）**：两个函数加 `if(!resp.ok) throw new Error(...status...)`，让 `runAgent` 的 catch 正常走降级或如实标错；并把非 2xx 映射成 `error` step（覆盖 A5 的一半）。改动局限在 `src/adapters.mjs`，不影响 Sim 路径。

### P2 — 更优解把方案标题行当头号共识输出 · high · ✅ 已修复
**批评**：`composeOutput` 的 `body[0]` 标题行「针对…的方案（by X · Y，风格:Z）：」被 `splitPoints` 当要点、因三家标题相似聚成 `coverage=3` 最强共识，摧毁可信度。
**回应（✅ committee + backend 协调）**：`splitPoints` 增加噪声过滤，剔除含「方案（by」「风格：」「针对「…」的方案」等元信息标题样式行；并让 `composeOutput` 不把标题塞进可聚类正文（标题与正文分离）。主修在 committee 过滤更稳妥，adapters 配合。
> `test/committee.cluster.test.mjs` 的 splitPoints 用例锁定切分契约，保证过滤改动不破坏正常要点切分。

### P4 — 定位混乱：相比 LangSmith / 手动并排问，Sim 版无独有价值 · medium · ⚖️ 战略回应（无代码改动）
**批评**：算法是浅层词重叠 + 固定阈值，归因是 4 条模板话，Sim 分析假数据、Live 核心 LLM 综合未实现且 trace 单步，既不能替代 LangSmith 也不如人读两段。
**回应（⚖️ 承认 + 🗺️ 聚焦）**：这是战略性批评而非具体 bug。承认当前为「演示评审管线的脚手架」而非生产工具。**聚焦方向**：不与 LangSmith 拼通用观测，而是收窄到一个独有窄场景 —— 接通一种框架（首选 Claude Agent SDK）的真实 jsonl transcript，对「同一 task、不同框架 × 模型」做**纵切面的深过程 diff + 逐条归因**（A8 → A4 → A5 串起来）。即「多 agent 横向并排 + trace 纵向逐步对比」这个组合，是手动并排问与单 run 观测工具都不直接给的视角。落地依赖 A8，记为产品方向。

---

## 安全（security）

### S1 — 浏览器 / standalone 版把 API key 塞进前端 fetch：泄露 key 且 CORS 调不通 · critical · ✅ 已修复（backend）
**批评**：`build-standalone` 把 adapters 原样编进 `docs/index.html`，`callAnthropic` / `callOpenAI` 用 `__ENV.ANTHROPIC_API_KEY` 在浏览器直接 fetch `api.anthropic.com`，无 `anthropic-dangerous-direct-browser-access` 头；注释引导注入 `window.AKER_ENV` 启 Live。既泄露 key 又是 CORS 死代码。
**回应（✅ backend）**：在 `build-standalone` 的 `envSafe` 编译阶段，把浏览器版的 `callAnthropic` / `callOpenAI` 替换为抛错存根，`capabilities()` 在浏览器恒返回 `live:false`，并删除 envShim 里「注入 `window.AKER_ENV` 可启 Live」的引导。真 Live 必须经 `server.mjs` 后端代理。Node 路径不受影响。

### S2 — `server.mjs` `body()` 无大小上限 + 默认监听 0.0.0.0：内存型 DoS · high · ✅ 已修复（backend）
**批评**：`body()` 把整个请求体读进内存无字节上限；`server.listen(PORT)` 未绑 host，默认 0.0.0.0，同网段可 POST 超大 body 拖垮进程。
**回应（✅ backend）**：`body()` 累加字节超 1MB 即 `req.destroy()` 返回 413；`server.listen` 显式绑定 `127.0.0.1`（`HOST` env 可覆盖以保留对外可能）。

### S3 — `server.listen` 无 error 监听：端口占用直接崩溃 · medium · ✅ 已修复（backend）+ 🗺️
**批评**：`server.listen` 只有成功回调，`EADDRINUSE` 抛未捕获异常退出；Electron 端 `waitForServer` 跑满超时后仍 `createWindow` 加载连不上的 URL，用户看空白无法定位。
**回应（✅ backend + 🗺️）**：server 加 `server.on('error')`，`EADDRINUSE` 时打印明确信息并 `process.exit(1)`。
**🗺️ 路线图**：Electron 端口自增重试（占用时换端口再起）属增强，记为路线图。

### S4 — `esc()` 不转义引号却插值进 HTML 属性，属性注入隐患 · low · ✅ 已修复（部分）+ 🗺️
**批评**：`esc()` 只替换 `& < >`，不处理 `" '`；`title="${esc(src.how)}"`、`style="background:${m.color}"`（color 未 esc）。当前数据可信不可利用，但是脆弱模式。
**回应（✅ frontend + 🗺️）**：`esc()` 增加 `" → &quot;`、`' → &#39;`，正则改为 `/[&<>"']/g`。纯防御性，对现有可信常量无影响。
**🗺️ 路线图**：`m.color` 直接插进 `style` 仍未走 esc（color 是受控常量，当前不可利用）；改 class 化成本较高，记为路线图。

---

## 无障碍（accessibility）

### X1 — 全局禁用焦点轮廓 + 无 `:focus-visible`：纯键盘用户看不到焦点 · critical · ✅ 已修复（frontend）
**批评**：`styles.css:72` `textarea.task:focus{outline:none}` 去轮廓无替代，全文件无 `:focus-visible`，违反 WCAG 2.4.7。
**回应（✅ frontend）**：删掉 `outline:none`，新增全局 `a/button/select/textarea/summary:focus-visible{outline:2px solid …;outline-offset:2px}`，激活态用深色双层环保证可见。

### X2 — 标签页用裸 button 无 ARIA，屏幕阅读器读不出选中态 · high · ✅ 已修复（frontend）
**批评**：`nav#tabs` 4 个裸 button 仅靠 class active，无 `role=tablist/tab`、`aria-selected`，panel 无 `role=tabpanel`。
**回应（✅ frontend）**：nav 加 `role="tablist"`，button 加 `role="tab"` + `aria-controls`，section 加 `role="tabpanel"` + `aria-labelledby`；切换时设 `aria-selected` 与 tabindex roving。**保留 `nav id=tabs` 与 `data-tab` 选择器不变**（硬性要求）。

### X3 — 表单 label 无 `for` 关联 · high · ✅ 已修复（frontend）
**批评**：label 无 for；动态 select 无 id / aria-label；reviewRun / traceA / B 无 label；移除按钮仅 `title=移除`。
**回应（✅ frontend）**：label 加 for + 控件 id；动态 select 加 `aria-label="框架" / "模型"`；各 picker select 加 aria-label；移除按钮 `aria-label="移除该 agent"`、× 包 `aria-hidden`。不破坏现有 class 选择器。

### X4 — 动态结果区无 ARIA live region · medium · ✅ 已修复（frontend）
**批评**：`runStatus` / `committeeOut` / `traceOut` innerHTML 注入对 SR 完全静默。
**回应（✅ frontend）**：三处加 `aria-live="polite"` + `aria-atomic="true"`，运行 / 评审时按钮 `aria-busy`；失败容器 `role="alert"`。

### X5 — 大面积文字对比度低于 WCAG AA · high · ✅ 已修复（frontend）
**批评**：实测 `--faint` 2.66–2.97、`--amber` 2.94、white-on-accent 3.12、trace badge 白字 native 3.30 / cli-log 3.19 / otel 3.68 均 < 4.5。
**回应（✅ frontend + backend 协调）**：调色 `--faint` → ~`#6f6a60`、`--amber` 文本更深、主按钮背景加深、trace-badge 文字改深 ink，确保正文 / 小字 ≥ 4.5、大文本 ≥ 3。`TRACEABILITY_META.color` 由 backend 配合（或前端 badge 文字改深 ink 避免跨域）。

### X6 — 状态 / 分级仅用颜色编码，无文字 / 形状冗余 · medium · ✅ 已修复（frontend）
**批评**：status running / done / error 仅颜色圆点无文字 / aria；trace step emoji 未 aria-hidden；modedot 对 SR 是噪声。
**回应（✅ frontend）**：状态点加 `aria-label`（执行中 / 已完成 / 失败）；step emoji 包 `aria-hidden` 并在 label 补类型文字；装饰圆点 modedot 加 `aria-hidden`。

### X7 — 缺少 skip link / 地标 / 单一 h1 层级 / 表头 scope · low · ✅ 已修复（部分）+ 🗺️
**批评**：main 无 aria-label 无 skip link；h 层级混乱；matrix th 无 scope。
**回应（✅ frontend + 🗺️）**：本轮做低成本项 —— matrix th 加 `scope="col"`、main 加 `id` + `aria-label`、加 skip link。
**🗺️ 路线图**：h 层级整理（卡片标题统一降为 h3）涉及多处，记为路线图。

### X8 — 任务输入框无 placeholder / 长度约束 / 快捷提交 · medium · ✅ 已修复（部分）
**批评**：task 无 placeholder，无上限，无 Cmd / Ctrl+Enter 提交。
**回应（✅ frontend，部分成立）**：加 placeholder、maxlength、Cmd / Ctrl+Enter 提交监听。「任务太短跑不出差异」一类软提示价值有限，从略。

---

## 用户体验（ux）

### U1 — Live 按钮无 key 时仍可点且静默降级，三处模式信号互相矛盾 · high · ✅ 已修复（frontend）
**批评**：侧栏说 Sim、Live 按钮可点并高亮 active、卡片说降级，三处打架；本机无 key 是最高频首用路径。
**回应（✅ frontend）**：init 拿到 `health.live`；若 false 给 Live 按钮加 `disabled` + title「未检测到 API key，无法 Live」，并锁定 `STATE.mode='sim'`。同时覆盖 H6（Pages 恒 Sim 的按钮治理）。不破坏选择器。

### U2 — 评审会 / Trace 两个核心 Tab 首次进入空白 · high · ✅ 已修复（frontend）
**批评**：`committeeOut` / `traceOut` 初始空 div，进 Tab 只剩孤零下拉 + 按钮，核心卖点藏在盲点击后。
**回应（✅ frontend）**：两个容器加初始 `.empty` 引导卡，并在 picker 有 run 时自动跑一次 `doReview()` / `doTraceDiff()`。

### U3 — 全产品零导出 / 复制 / 分享 · high · ✅ 已修复（部分）+ 🗺️
**批评**：最终产出（更优解 markdown、trace 结论）全站无 export / 复制 / 下载 / permalink，价值闭环断裂。
**回应（✅ frontend + 🗺️）**：本轮在「更优解」卡与 trace 结论卡加「复制 Markdown」按钮（`navigator.clipboard`，零依赖）。
**🗺️ 路线图**：下载 `.md` / `.json` 与 URL permalink 成本略高，记为路线图。

### U4 — 并行运行实时感是假的 · medium · ✅ 已修复（部分）+ 🗺️
**批评**：`/api/run` 一次性 POST，`allSettled` 全跑完才返回，所有卡同生同灭。
**回应（✅ frontend + 🗺️）**：本轮 `runStatus` 加计时 / 旋转指示并提示「Live 模式下单 agent 可能数十秒」。
**🗺️ 路线图**：真正逐个落地需后端 SSE / 分块流，记为路线图。

### U5 — Trace 对比可发现性差 · medium · ✅ 已修复（frontend）
**批评**：单 agent run 下 A == B，点对比才报错；下拉只显 label。
**回应（✅ frontend）**：单 agent run 时禁用对比按钮并提示「需 ≥ 2 个 agent」；A / B 选同值实时禁用；option 文案补 `framework × model`。

### U6 — 窄窗下侧栏固定 232px 不收起 · medium · ✅ 已修复（frontend）
**批评**：`.shell` 写死 `232px 1fr` 无窄屏断点；只有 820px 给部分降单列。
**回应（✅ frontend）**：加 `@media(max-width:680px)`：shell 单列、侧栏变顶部横向 nav，agent-row 堆单列，deltas 换行。纯 CSS、不动结构与选择器。

---

## 路线图汇总（按优先级）

1. **扩展真实多步 trace（A8）** —— Codex CLI 已接通；下一步是 Claude Agent SDK transcript 与 OTel。
2. **语义 embedding 聚类（A1）** —— 替代字面 Jaccard，消除中文同义改写误报；`test/committee.cluster.test.mjs` 已埋好翻转点。
3. **真语料 Sim demo（P1）** —— 用真实导出语料替换模板字符串，让 Sim 不再是自证循环。
4. **聚类稳健性（A2）** —— 固定锚点 centroid、阈值敏感度自检，消除顺序依赖。
5. **独立性加权 consensus（A6）** —— 按 vendor 去相关，防同源共同偏见。
6. **导出 / permalink（U3）、SSE 流式运行（U4）、Electron 端口重试（S3）** —— 体验与健壮性增强。
