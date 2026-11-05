# @ruihua/vue-template-compiler-patched

[English](README.md) | 简体中文

这是一个经过安全加固的 `vue-template-compiler` 版本，旨在修复原型污染辅助代码生成漏洞（CVE-2024-6783）和原始文本解析器 ReDoS 漏洞（CVE-2024-9506）。

> 基于 [vue-template-compiler@2.7.16](https://github.com/vuejs/vue/tree/v2.7.16/packages/template-compiler)。开发和问题反馈请访问 [vue-patched](https://github.com/bio/vue-patched)。

## 相关项目

如果你使用 Vue 完整版（运行时 + 编译器）或 CDN 提供的 `vue.js`，也请将 `vue` 替换为 [vue-patched](https://github.com/bio/vue-patched)。

此软件包可将 Vue 2.0 模板预编译为渲染函数，从而避免运行时编译开销和 CSP 限制。大多数情况下建议与 [`vue-loader`](https://github.com/vuejs/vue-loader) 一起使用；只有在编写有特定需求的构建工具时，才需要单独使用它。

## 安全加固与适用范围

- 编译器创建的 AST 元素、文本/注释节点、SSR 分组节点以及属性/事件/插槽字典均使用空原型。因此，客户端和 SSR 代码生成不会继承环境中的 `Object.prototype` 元数据。
- 编译器选项和指令的合并仅复制对象自身的可枚举属性。显式提供的自定义模块和指令仍属于受信任的编译器扩展。
- `script`、`style` 和 `textarea` 的原始文本解析改为前向扫描，不再使用可能回溯的内容正则。扫描器保留了原有的结束标签匹配、错误恢复行为和源码范围信息。
- 此补丁无法阻止其他依赖污染原型，不能让不可信的 Vue 模板变得安全，也不会修补单独 Vue 完整版中内嵌的编译器。请确认你的工具链实际解析到了这个补丁包。

**兼容性：** AST 节点和编译器字典不再继承 `Object` 方法。自定义编译器工具应使用 `Object.keys(value)` 和 `Object.prototype.hasOwnProperty.call(value, key)`，而不是 `value.hasOwnProperty(key)`。继承得到的编译器选项和指令会被有意忽略；请将它们作为对象自身的属性提供。

**Fork 软件包：** `@ruihua/vue-template-compiler-patched` 保留 Vue 2.7.16 基线，首次发布时沿用现有的 `2.7.16-patch.3` 版本号。上游 MIT 许可证和署名均予以保留。

### 回归测试

在此源码仓库中运行：

```sh
npm test
```

测试可在 Node 中离线运行，不会打开浏览器或安装依赖。测试覆盖两个分发构建、客户端/SSR 代码生成、安全的继承字段标记、普通模板兼容性、SFC 提取以及有界时间的原始文本解析检查。Node 测试构建会在隔离的 VM 环境中使用 `browser.js` 内嵌的真实依赖实现；这并不是下游构建工具集成测试。

## 安装

选择适合你的安装方式。

### 别名安装方式

将补丁编译器安装为原始的 `vue-template-compiler` 名称，因此可以满足 peer dependency 要求，并继续解析现有的软件包引用（例如 `@vue/test-utils` 中的引用）。

#### npm

```sh
npm install vue-template-compiler@npm:@ruihua/vue-template-compiler-patched@^2.7.16-patch.3 --save-dev
```

#### pnpm

```sh
pnpm add vue-template-compiler@npm:@ruihua/vue-template-compiler-patched@^2.7.16-patch.3 --save-dev
```

#### Yarn

```sh
yarn add vue-template-compiler@npm:@ruihua/vue-template-compiler-patched@^2.7.16-patch.3 --dev
```

### 标准安装方式

将编译器安装为 `@ruihua/vue-template-compiler-patched`。如果只需要直接访问补丁构建，请使用此方式。通过 `vue-template-compiler` 包名解析依赖的工具将无法自动识别它。

#### npm

```sh
npm install @ruihua/vue-template-compiler-patched --save-dev
```

#### pnpm

```sh
pnpm add @ruihua/vue-template-compiler-patched --save-dev
```

#### Yarn

```sh
yarn add @ruihua/vue-template-compiler-patched --dev
```

#### 用法

```js
import compiler from '@ruihua/vue-template-compiler-patched'
// or: const compiler = require('@ruihua/vue-template-compiler-patched')
```

## API

### compiler.compile(template, [options])

编译模板字符串并返回编译后的 JavaScript 代码。返回结果的格式如下：

```js
{
  ast: ?ASTElement, // 解析得到的模板元素 AST
  render: string, // 主渲染函数代码
  staticRenderFns: Array<string>, // 静态子树的渲染代码（如果有）
  errors: Array<string> // 模板语法错误（如果有）
}
```

请注意，返回的函数代码使用了 `with`，因此不能在严格模式代码中使用。

#### 选项

- `outputSourceRange` *2.6 新增*
  - 类型：`boolean`
  - 默认值：`false`

  设为 `true` 后，编译结果中的 `errors` 会变为 `{ msg, start, end }` 格式的对象。`start` 和 `end` 是数字，表示错误来源在模板中的代码范围。可将它们传给 `compiler.generateCodeFrame` API，以生成错误代码片段。

- `whitespace`
  - 类型：`string`
  - 有效值：`'preserve' | 'condense'`
  - 默认值：`'preserve'`

  默认的 `'preserve'` 会按以下方式处理空白字符：

  - 标签之间仅包含空白字符的文本节点会被压缩为一个空格。
  - 其他所有空白字符均按原样保留。

  如果设为 `'condense'`：

  - 标签之间仅包含空白字符的文本节点若含有换行符则会被移除，否则会压缩为一个空格。
  - 非纯空白文本节点中的连续空白字符会被压缩为一个空格。

  使用压缩模式可以减小编译后代码的体积并略微提升性能，但在某些情况下会导致与普通 HTML 相比出现轻微的视觉布局差异。

  **此选项不会影响 `<pre>` 标签。**

  示例：

  ```html
  <!-- 源码 -->
  <div>
    <span>
      foo
    </span>   <span>bar</span>
  </div>

  <!-- whitespace: 'preserve' -->
  <div> <span>
    foo
    </span> <span>bar</span> </div>

  <!-- whitespace: 'condense' -->
  <div><span> foo </span> <span>bar</span></div>
  ```

- `modules`

  可以通过钩入编译过程来支持自定义模板功能。**但请注意，注入自定义编译时模块后，模板将无法与基于标准内置模块的其他构建工具（例如 `vue-loader` 和 `vueify`）配合使用。**

  编译器模块数组。详情请参阅 [Flow 声明](https://github.com/vuejs/vue/blob/dev/flow/compiler.js#L47-L59)中的 `ModuleOptions` 类型和[内置模块](https://github.com/vuejs/vue/tree/dev/src/platforms/web/compiler/modules)。

- `directives`

  一个对象，键为指令名称，值为转换模板 AST 节点的函数。例如：

  ```js
  compiler.compile('<div v-test></div>', {
    directives: {
      test (node, directiveMeta) {
        // 根据 directiveMeta 转换节点
      }
    }
  })
  ```

  默认情况下，编译时指令会被提取，不会保留到运行时。如果希望该指令也由运行时定义处理，请在转换函数中返回 `true`。

  请参考部分[内置编译时指令](https://github.com/vuejs/vue/tree/dev/src/platforms/web/compiler/directives)的实现。

- `preserveWhitespace` **自 2.6 起已弃用**
  - 类型：`boolean`
  - 默认值：`true`

  默认情况下，编译后的渲染函数会保留 HTML 标签之间的所有空白字符。设为 `false` 后，标签之间的空白字符会被忽略。这可能略微提升性能，但也可能影响行内元素的布局。

---

### compiler.compileToFunctions(template)

与 `compiler.compile` 类似，但会直接返回实例化后的函数：

```js
{
  render: Function,
  staticRenderFns: Array<Function>
}
```

此方法仅适用于使用预配置构建的运行时，因此不接受编译时选项。此外，该方法会使用 `new Function()`，所以不符合 CSP 要求。

---

### compiler.ssrCompile(template, [options])

> 2.4.0+

与 `compiler.compile` 相同，但会生成 SSR 专用渲染函数代码，将模板的部分内容优化为字符串拼接，以提升 SSR 性能。

`vue-loader@>=12` 默认使用此方法，也可以通过 [`optimizeSSR`](https://vue-loader.vuejs.org/options.html#optimizessr) 选项将其禁用。

---

### compiler.ssrCompileToFunctions(template)

与 `compiler.compileToFunction` 类似，但会生成 SSR 专用渲染函数代码，并通过字符串拼接优化模板的部分内容，以提升 SSR 性能。

---

### compiler.parseComponent(file, [options])

将 SFC（单文件组件，即 `*.vue` 文件）解析为描述对象（请参阅 [Flow 声明](https://github.com/vuejs/vue/blob/dev/flow/compiler.js)中的 `SFCDescriptor` 类型）。此方法用于 `vue-loader` 和 `vueify` 等 SFC 构建工具。

---

### compiler.generateCodeFrame(template, start, end)

生成代码片段，并高亮 `template` 中由 `start` 和 `end` 指定的部分，可用于上层工具的错误报告。

#### 选项

#### `pad`

如果要将提取出的内容传给其他预处理器，`pad` 可确保发生语法错误时行号或字符索引正确。

- 使用 `{ pad: "line" }` 时，每个代码块提取内容前会按原文件中前置内容的行数添加换行符，以确保行号与原文件对齐。
- 使用 `{ pad: "space" }` 时，每个代码块提取内容前会按原文件中前置内容的字符数添加空格，以确保字符数与原文件保持一致。
