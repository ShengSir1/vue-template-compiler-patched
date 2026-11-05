# 安全补丁核查报告

> **修复状态更新（2026-11-05）：** 下文为原始提交的历史审计结论。当前工作区已按建议完成代码修复；历史发现不应再直接当作修复后代码的测试结果。
>
> - 两份构建统一隔离 AST、SSR 中间节点及属性/事件/插槽/CSS 字典，并按自有属性合并编译选项与指令。
> - 原始文本内容正则已移除，改为单向结束标签扫描；保持旧版正常模板输出、结束标签兼容性及源码位置。
> - 新增离线回归套件：Node v16.20.2 与 Node v24.22.1 各 **540 项通过、0 项失败**；另做 60 项正常原始文本解析事件对照全部通过。
> - 测试包含正常代码生成对照、SSR/客户端无害继承标记、可枚举/不可枚举字段、SFC、原型同名属性、扩展模块/指令、包入口版本检查，以及有界异常输入恢复与扫描工作量检查。不执行攻击表达式或生成的污染代码。
> - 当前未发布 npm 新版本；未执行依赖安装后的业务项目集成测试。自定义编译扩展是可信代码边界，不承诺任意原型污染环境下的全局安全，也不使不可信模板安全。
> - 复验：在源码目录执行 npm test。原始文件 SHA-256 仅标识下文审计的旧版本。

- 核查日期：2026-11-05（Asia/Shanghai）
- 对象：vue-template-compiler-patched 2.7.16-patch.3
- Git 提交：e9cd3cb8ce256280b075b5edabedeba824f29607
- 范围：本地 package.json、index.js、build.js、browser.js、README.md；不代表对使用方项目的部署审计。

## 结论

**当前版本不能认定为完整修复 CVE-2024-6783 和 CVE-2024-9506。**

| 项目 | 核查结果 |
| --- | --- |
| CVE-2024-6783 常见客户端 class/style 继承属性入口 | 已增加有效的自有属性检查，本次安全标记测试通过 |
| CVE-2024-6783 同类 SSR class/style 入口 | 未覆盖；继承属性仍能进入生成结果 |
| 客户端其他 AST 字段的继承属性信任 | 仍存在；不能把局部补丁等同于完整原型链隔离 |
| CVE-2024-9506 原始文本解析 | 补丁正则仍不安全，限时本地测试触发超时；不能宣称已修复 |

## 发现一：原型污染防护是局部的

### 生效部分

build.js:3876-3884、3926-3934，以及 browser.js:3981-3989、4031-4039，分别对 staticClass、classBinding、staticStyle、styleBinding 使用 Object.prototype.hasOwnProperty.call。

在独立 Node VM 上下文中，逐个为原型设置不可枚举的普通字符串/对象字面量标记，再编译正常模板。两个构建的 compile 输出均未包含这四类继承标记。测试没有使用可执行攻击表达式，也没有执行污染后的生成代码。

### 未覆盖部分

1. SSR 分支仍直接读取同类属性：build.js:6578-6583、browser.js:7044-7049。
2. SSR 的字符串节点生成会使用这些字段；build.js:6300-6324 可见后续处理。
3. 相同安全标记检查中，两个构建的 ssrCompile 输出均包含上述四类继承标记，且没有编译错误。
4. AST 元素仍由普通对象创建：build.js:4092-4101、browser.js:4542-4551。
5. 进一步的无害标记检查还发现 key、ref 仍能从原型进入两个构建的 compile/ssrCompile 生成结果；对应 build.js:5576-5581、browser.js:6033-6038。

上述结果直接证明继承属性的信任边界仍未完整关闭；并不等同于已经在真实业务中演示 XSS 或服务端代码执行。是否可实际利用，仍取决于攻击者能否先污染相应原型、编译调用是否可达、生成结果是否被使用等前提。

## 发现二：ReDoS 补丁引入了高风险回溯结构

位置：build.js:424-426、browser.js:468-470。

相对 Vue 2.7.16 官方 html-parser.ts，当前补丁将原来的非贪婪内容匹配替换为包含内层可变长度重复、外层重复及负向前瞻的表达式。缺少预期结束标签时，普通文本也可能造成大量分组回溯；表达式还未锚定，不能仅凭修改过正则认定复杂度已得到控制。

### 限时测试结果

所有测试均在本机独立 VM 上下文执行，每次最多 150ms，不连接浏览器、不发送网络攻击请求、不执行长时间压力测试。

- Node v16.20.2 / V8 9.4.146.26-node.26：build.js 与 browser.js 的 compile、ssrCompile、parseComponent，六个组合都出现 ERR_SCRIPT_EXECUTION_TIMEOUT，实测约 151-162ms。
- Node v24.22.1 / V8 13.6.233.17-node.58：两个构建的 compile 同样触发 150ms 超时。
- 内存对照：仅将问题正则恢复为 Vue 2.7.16 的原始形式，在相同小型测试输入上约 3-5ms 完成。此对照只用来定位新增回溯问题，**不表示原始 Vue 2.7.16 正则安全或建议回退到原版**。

没有运行公告中的大体量拒绝服务示例。本报告也不附可投放的攻击模板或利用脚本。

## 功能与测试边界

- 两个构建的普通文本、静态 class/style、动态绑定、正确闭合 textarea 与 SFC 提取，共 34 项冒烟检查通过。
- 冒烟检查覆盖 compile、ssrCompile、compileToFunctions、ssrCompileToFunctions；SFC 使用 parseComponent。
- 当前检出目录没有安装 he、de-indent，不能直接按普通 require 流程加载 Node 包入口。因此 build.js 通过内存 VM 加载，并使用 browser.js 内实际打包的 he/de-indent 实现提供依赖，没有用简化假实现代替。
- 未安装依赖、未修改业务 JS、未修改包版本、未访问浏览器、未读取账号密码。
- 本报告是有边界的安全代码核查及回归检查，不是完整渗透测试，也不是对所有潜在原型字段和所有解析输入的安全证明。

## 建议修复方向

1. 统一处理 AST 与其字典的原型隔离/自有属性语义，覆盖客户端、SSR 及优化器创建的中间节点，避免只修四处生成字段。
2. 对原始文本结束标签采用单向扫描等可证明受控复杂度的实现，正确处理没有结束标签的输入；不要把旧正则回退作为最终修复。
3. 同步生成 build.js 与 browser.js，并添加安全标记隔离、SSR 路径、缺失结束标签、正常模板与 SFC 的回归测试。
4. 使用方应确认实际解析的是修补包；只安装新包名不一定替换工具链对 vue-template-compiler 的查找。Vue 完整构建内置编译器也不因本包变更而自动修复。
5. 修复并重新验证前，不建议沿用 README 中“不加范围限制地同时修复两个 CVE”的表述。

## 公共核对来源

以下内容通过匿名 HTTPS 读取，不使用账号或凭据。GitHub 公告的示例仅用于了解漏洞范围，没有照搬执行。

- CVE-2024-6783 / GHSA-g3ch-rx76-35fx：`https://github.com/advisories/GHSA-g3ch-rx76-35fx`
- CVE-2024-9506 / GHSA-5j4c-8p2g-v4jx：`https://github.com/advisories/GHSA-5j4c-8p2g-v4jx`
- Vue 2.7.16 原始解析器：`https://raw.githubusercontent.com/vuejs/vue/v2.7.16/src/compiler/parser/html-parser.ts`
- Vue 2.7.16 class 模块：`https://raw.githubusercontent.com/vuejs/vue/v2.7.16/src/platforms/web/compiler/modules/class.ts`
- Vue 2.7.16 style 模块：`https://raw.githubusercontent.com/vuejs/vue/v2.7.16/src/platforms/web/compiler/modules/style.ts`
- CVE 发布方 HeroDevs 页面返回 HTTP 403，未作为已读取的证据。

## 被审计文件 SHA-256

- build.js：A8A9C8F6C0E9FA6BA53873B65D85263EF3AB6FD5F92B8B1AE0B4B8E732889D79
- browser.js：8756E0DC56743778446BCDD40EE9C9B8E1A199926D2772F50832C1DE0E4449E2
