const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createRequire } = require('module');

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function createTsRuntime() {
  const cache = new Map();
  const nativeRequire = createRequire(__filename);

  function load(filePath) {
    const resolved = path.resolve(filePath);
    if (cache.has(resolved)) return cache.get(resolved).exports;

    const source = fs.readFileSync(resolved, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: resolved,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        sourceMap: false,
        inlineSourceMap: false,
        inlineSources: false,
      },
    }).outputText;

    const module = { exports: {} };
    cache.set(resolved, module);

    const localRequire = (specifier) => {
      if (specifier.startsWith('.')) {
        const next = resolveLocal(resolved, specifier);
        if (!next) {
          throw new Error(`Cannot resolve ${specifier} from ${resolved}`);
        }
        return load(next);
      }
      return nativeRequire(specifier);
    };

    const wrapped = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
    wrapped(localRequire, module, module.exports, resolved, path.dirname(resolved));
    return module.exports;
  }

  return { load };
}

module.exports = { createTsRuntime };
