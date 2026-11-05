'use strict';

// Offline regression tests: no browser, network, exploit expressions or payload execution.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const browserSource = fs.readFileSync(path.join(root, 'browser.js'), 'utf8');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'compatibility-fixtures.json'), 'utf8'));
let passed = 0;
let failed = 0;

function test(name, run) {
  try {
    run();
    passed++;
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + '\n' + error.stack);
  }
}

function load(file, environment, beforeLoad, exposeParser) {
  const box = {
    exports: {},
    process: { env: { NODE_ENV: environment || 'development' } },
    console: { warn() {}, error() {}, log() {} }
  };
  box.module = { exports: box.exports };
  const context = vm.createContext(box);
  if (beforeLoad) vm.runInContext(beforeLoad, context, { timeout: 500 });
  if (file === 'build.js') {
    // Use the real dependency implementations shipped in the standalone bundle.
    // This keeps tests offline without fake entity decoding or indentation stubs.
    const anchor = 'exports.compile = compile$1;';
    assert(browserSource.includes(anchor), 'Missing bundled dependency export anchor');
    const bootstrap = browserSource.replace(anchor,
      'exports.__testDependencies = { "he": he$1.exports, "de-indent": deIndent };\n' + anchor);
    vm.runInContext(bootstrap, context, { timeout: 2000 });
    const dependencies = box.module.exports.__testDependencies;
    box.require = function (name) {
      assert(Object.prototype.hasOwnProperty.call(dependencies, name), 'Unexpected dependency: ' + name);
      return dependencies[name];
    };
    vm.runInContext('module = { exports: {} }; exports = module.exports;', context, { timeout: 500 });
    let source = fs.readFileSync(path.join(root, file), 'utf8');
    if (exposeParser) source = source.replace('exports.compile = compile$1;', 'exports.__parseHTML = parseHTML; exports.__findRawTextEnd = findRawTextEnd; exports.compile = compile$1;');
    vm.runInContext(source, context, { timeout: 2000 });
  } else {
    const source = exposeParser ? browserSource.replace('exports.compile = compile$1;', 'exports.__parseHTML = parseHTML; exports.__findRawTextEnd = findRawTextEnd; exports.compile = compile$1;') : browserSource;
    vm.runInContext(source, context, { timeout: 2000 });
  }
  return { context, box, compiler: box.module.exports };
}

function evaluate(state, code, timeout) {
  return vm.runInContext(code, state.context, { timeout: timeout || 1000 });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function output(result) {
  return [result.render].concat(result.staticRenderFns).join('\n');
}

function checkAst(node, visited) {
  if (!node || visited.has(node)) return;
  visited.add(node);
  assert.strictEqual(Object.getPrototypeOf(node), null, 'AST node inherits a prototype');
  if (node.type === 1) {
    assert.strictEqual(Object.getPrototypeOf(node.attrsMap), null, 'Attribute map inherits a prototype');
    assert.strictEqual(Object.getPrototypeOf(node.rawAttrsMap), null, 'Raw attribute map inherits a prototype');
    ['events', 'nativeEvents', 'scopedSlots'].forEach(function (key) {
      if (node[key]) assert.strictEqual(Object.getPrototypeOf(node[key]), null, key + ' inherits a prototype');
    });
    (node.children || []).forEach(function (child) { checkAst(child, visited); });
    (node.ifConditions || []).forEach(function (condition) { checkAst(condition.block, visited); });
    if (node.scopedSlots) Object.keys(node.scopedSlots).forEach(function (key) { checkAst(node.scopedSlots[key], visited); });
  }
}

const codegenProperties = [
  'staticClass', 'staticStyle', 'classBinding', 'styleBinding', 'key', 'ref',
  'refInFor', 'component', 'attrs', 'props', 'events', 'nativeEvents', 'scopedSlots',
  'slotTarget', 'slotScope', 'model', 'directives', 'dynamicAttrs', 'wrapData', 'wrapListeners',
  'inlineTemplate', 'if', 'else', 'elseif', 'for', 'once', 'pre', 'staticRoot', 'staticInFor',
  'staticProcessed', 'forProcessed', 'ifProcessed', 'onceProcessed', 'isComment', 'expression',
  'children', 'parent', 'ssrOptimizability', 'hasBindings', 'ns',
  'v-if', 'v-for', 'v-html', 'v-text', 'v-show', 'v-pre', 'v-once', ':is', ':key', ':class', ':style',
  'modules', 'optimize', 'transformNode', 'transformCode', 'genData', 'isUnaryTag', 'warn'
];

for (const file of ['build.js', 'browser.js']) {
  const state = load(file);
  for (const fixture of fixtures.templates) {
    for (const api of ['compile', 'ssrCompile']) {
      test(file + ' compatibility ' + api + ' ' + fixture.name, function () {
        const result = state.compiler[api](fixture.template, fixture.options);
        assert.deepStrictEqual(plain({ render: result.render, staticRenderFns: result.staticRenderFns,
          errors: result.errors, tips: result.tips }), fixture.expected[api]);
        checkAst(result.ast, new Set());
      });
    }
    for (const api of ['compileToFunctions', 'ssrCompileToFunctions']) {
      test(file + ' functions ' + api + ' ' + fixture.name, function () {
        const result = state.compiler[api](fixture.template, fixture.options);
        assert.strictEqual(typeof result.render, 'function');
        result.staticRenderFns.forEach(function (fn) { assert.strictEqual(typeof fn, 'function'); });
      });
    }
  }
  for (const fixture of fixtures.sfcs) {
    test(file + ' SFC compatibility ' + fixture.name, function () {
      const result = state.compiler.parseComponent(fixture.source, fixture.options);
      assert.deepStrictEqual(plain(result), fixture.expected);
      [result.template, result.script, result.scriptSetup].concat(result.styles, result.customBlocks)
        .filter(Boolean).forEach(function (block) {
          assert.strictEqual(Object.getPrototypeOf(block.attrs), null);
        });
    });
  }

  for (const environment of ['development', 'production']) {
    for (const property of codegenProperties) {
      test(file + ' inherited field isolation ' + environment + ' ' + property, function () {
        const isolated = load(file, environment);
        isolated.box.testProperty = property;
        evaluate(isolated, 'Object.defineProperty(Object.prototype, testProperty, {' +
          'value: "AUDIT_INHERITED", enumerable: true, writable: true, configurable: true });');
        for (const api of ['compile', 'ssrCompile']) {
          isolated.box.testApi = api;
          const result = evaluate(isolated,
            'module.exports[testApi](\'<div id="safe"><p>text</p><span>{{message}}</span><!--comment--></div>\', {comments:true, outputSourceRange:true})');
          assert(!output(result).includes('AUDIT_INHERITED'), api + ' trusted an inherited field');
          assert.strictEqual(result.errors.length, 0, api + ' produced compile errors');
          checkAst(result.ast, new Set());
        }
        const sfc = evaluate(isolated,
          'module.exports.parseComponent(\'<template><div>x</div></template><script>export default {}</script><style>.x{color:red}</style>\')');
        assert(sfc.template && sfc.script && sfc.styles.length === 1);
      });
    }

    test(file + ' inheritance before initialization ' + environment, function () {
      const isolated = load(file, environment,
        'Object.defineProperty(Object.prototype, "staticClass", {' +
        'value: "AUDIT_INHERITED", enumerable: true, configurable:true, writable:true});');
      for (const api of ['compile', 'ssrCompile']) {
        const result = isolated.compiler[api]('<div><p>text</p><span>{{message}}</span></div>');
        assert(!output(result).includes('AUDIT_INHERITED'));
      }
    });

    test(file + ' own metadata preserved ' + environment, function () {
      const isolated = load(file, environment);
      evaluate(isolated, 'Object.defineProperty(Object.prototype, "staticClass", {' +
        'value:"AUDIT_INHERITED", configurable:true, writable:true});');
      const result = evaluate(isolated,
        'module.exports.compile(\'<div class="safe" :class="classes" style="color:red" :style="styles" :key="id" ref="item">{{message}}</div>\')');
      assert(output(result).includes('staticClass:"safe"'));
      assert(output(result).includes('staticStyle:{"color":"red"}'));
      assert(output(result).includes('class:classes'));
      assert(output(result).includes('style:(styles)'));
      assert(output(result).includes('key:id'));
      assert(output(result).includes('ref:"item"'));
    });

    test(file + ' readonly prototype metadata ' + environment, function () {
      const isolated = load(file, environment);
      evaluate(isolated, 'Object.defineProperty(Object.prototype,"staticClass",{' +
        'value:"AUDIT_INHERITED", configurable:true});');
      const result = evaluate(isolated, 'module.exports.compile(\'<div class="safe">ok</div>\')');
      assert(output(result).includes('staticClass:"safe"'));
      assert(!output(result).includes('AUDIT_INHERITED'));
    });
  }

  test(file + ' function APIs ignore inherited metadata without executing results', function () {
    const isolated = load(file);
    evaluate(isolated, 'Object.defineProperty(Object.prototype,"staticStyle",{' +
      'value:"AUDIT_INHERITED", enumerable:true, writable:true, configurable:true});');
    for (const api of ['compileToFunctions', 'ssrCompileToFunctions']) {
      isolated.box.testApi = api;
      const result = evaluate(isolated,
        `module.exports[testApi]('<div><span>{{message}}</span></div>')`);
      assert.strictEqual(typeof result.render, 'function');
      assert(!result.render.toString().includes('AUDIT_INHERITED'));
      result.staticRenderFns.forEach(function (fn) { assert(!fn.toString().includes('AUDIT_INHERITED')); });
    }
  });

  test(file + ' inherited compiler options ignored', function () {
    const result = state.compiler.compile('<div>{{value}}</div>', Object.create({ delimiters: ['[[', ']]'] }));
    assert(output(result).includes('_s(value)'));
  });

  test(file + ' attribute names that shadow object methods', function () {
    const result = state.compiler.compile('<div hasOwnProperty="x" __proto__="value" constructor="c">x</div>', { outputSourceRange: true });
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.ast.attrsMap.hasOwnProperty, 'x');
    assert.strictEqual(result.ast.attrsMap.__proto__, 'value');
    assert.strictEqual(Object.getPrototypeOf(result.ast.attrsMap), null);
  });

  test(file + ' custom modules and directives remain supported', function () {
    const result = state.compiler.compile('<div v-audit>ok</div>', {
      modules: [{ transformNode(el) { el.staticClass = '"custom"'; } }],
      directives: { audit(el) { el.key = '"custom-key"'; return false; } }
    });
    assert.strictEqual(result.errors.length, 0);
    assert(output(result).includes('staticClass:"custom"'));
    assert(output(result).includes('key:"custom-key"'));
  });

  test(file + ' raw-text scanner source ranges and close semantics', function () {
    const internal = load(file, 'development', null, true).compiler;
    const parser = internal.__parseHTML;
    const scanner = internal.__findRawTextEnd;
    for (const tag of ['script', 'style', 'textarea']) {
      assert.strictEqual(scanner('ordinary text', tag), null);
      const content = 'a < b\n c';
      const tail = '</' + tag.toUpperCase() + ' data-x="1">';
      const start = '<' + tag + '>';
      const ends = [];
      let text = '';
      parser(start + content + tail, {
        start() {}, chars(value) { text += value; },
        end(name, from, to) { ends.push({ name, from, to }); }
      });
      assert.strictEqual(text, content);
      assert.deepStrictEqual(ends, [{ name: tag, from: start.length + content.length, to: start.length + content.length + tail.length }]);
      assert.strictEqual(scanner('ordinary text</' + tag, tag), null);
      assert.strictEqual(scanner('a</' + tag + '-suffix>', tag).start, 1);
    }
  });

  test(file + ' scanner work stays linear for ordinary valid text', function () {
    const scanner = load(file, 'development', null, true).compiler.__findRawTextEnd;
    for (const size of [128, 256, 512, 1024]) {
      const text = 'ordinary text '.repeat(Math.ceil(size / 14)).slice(0, size) + '</textarea>';
      let reads = 0;
      let searches = 0;
      const input = {
        length: text.length,
        charCodeAt(index) { reads++; return text.charCodeAt(index); },
        indexOf(value, index) { searches++; return text.indexOf(value, index); }
      };
      assert.strictEqual(scanner(input, 'textarea').start, size);
      assert(reads <= text.length + 16, 'Scanner revisited input characters');
      assert.strictEqual(searches, 1, 'Scanner repeated its closing-bracket search');
    }
  });

  test(file + ' event metadata ignores inherited modifier lookup entries', function () {
    const isolated = load(file);
    evaluate(isolated, 'Object.defineProperty(Object.prototype,"auditKey",{' +
      'value:"AUDIT_INHERITED", enumerable:true, configurable:true, writable:true});');
    for (const api of ['compile', 'ssrCompile']) {
      isolated.box.testApi = api;
      const result = evaluate(isolated,
        `module.exports[testApi]('<button @keyup.auditKey="save">Save</button>')`);
      assert.strictEqual(result.errors.length, 0);
      assert(!output(result).includes('AUDIT_INHERITED'));
    }
  });

  test(file + ' nested compiler records ignore inherited metadata', function () {
    const isolated = load(file);
    evaluate(isolated, 'Object.defineProperty(Object.prototype,"dynamic",{' +
      'value:"AUDIT_INHERITED", enumerable:true, configurable:true, writable:true});');
    for (const api of ['compile', 'ssrCompile']) {
      isolated.box.testApi = api;
      const result = evaluate(isolated,
        `module.exports[testApi]('<div :title="title" @click="save" v-custom="value">{{message}}</div>')`);
      assert.strictEqual(result.errors.length, 0);
      assert(!output(result).includes('AUDIT_INHERITED'));
      assert(output(result).includes('title'));
    }
  });

  test(file + ' non-enumerable inherited fields stay isolated', function () {
    const isolated = load(file);
    for (const key of ['staticStyle', 'classBinding', 'styleBinding', 'key', 'ref']) {
      isolated.box.testProperty = key;
      evaluate(isolated, 'Object.defineProperty(Object.prototype,testProperty,{' +
        'value:"AUDIT_INHERITED",configurable:true,writable:true});');
    }
    for (const api of ['compile', 'ssrCompile']) {
      const result = isolated.compiler[api]('<div><span>{{message}}</span></div>');
      assert.strictEqual(result.errors.length, 0);
      assert(!output(result).includes('AUDIT_INHERITED'));
    }
  });

  test(file + ' bounded malformed raw-text recovery', function () {
    for (const tag of ['script', 'style', 'textarea']) {
      for (const api of ['compile', 'ssrCompile', 'parseComponent']) {
        const isolated = load(file);
        isolated.box.testApi = api;
        // Small, fixed ordinary text; VM timeout prevents an accidental hang.
        isolated.box.testTemplate = '<' + tag + '>ordinary raw text without a closing tag';
        const result = evaluate(isolated, 'module.exports[testApi](testTemplate)', 500);
        assert(result);
      }
    }
  });
}

test('published bundles share identical security helpers', function () {
  function helper(source, name) {
    const start = source.indexOf('function ' + name + '(');
    const end = source.indexOf('\n' + (source === browserSource ? '\t' : '') + '}', start);
    assert(start >= 0 && end > start, 'Missing shared helper ' + name);
    return source.slice(start, end + (source === browserSource ? 3 : 2)).replace(/\s+/g, '');
  }
  const source = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
  for (const name of ['copyCompilerProperties', 'createCompilerObject', 'findRawTextEnd']) {
    assert.strictEqual(helper(source, name), helper(browserSource, name));
  }
});

test('Node package entry preserves Vue base-version matching', function () {
  const compiler = load('build.js').compiler;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const vueVersion of ['2.7.16', '2.7.16-patch.3', '2.6.14', null]) {
    const box = { module: { exports: {} } };
    box.require = function (name) {
      if (name === 'vue') {
        if (vueVersion === null) throw Error('Vue not installed');
        return { version: vueVersion };
      }
      if (name === './package.json') return pkg;
      if (name === './build') return compiler;
      throw Error('Unexpected module ' + name);
    };
    box.require.resolve = function (name) { return '/test-only/' + name; };
    const run = function () {
      vm.runInNewContext(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), box, { timeout: 1000 });
    };
    if (vueVersion === '2.6.14') assert.throws(run, /Vue packages version mismatch/);
    else { run(); assert.strictEqual(box.module.exports, compiler); }
  }
});

console.log('Node ' + process.version + ': ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
