# WASM SIMD 构建指南

## 🚀 快速构建

### 前置要求

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

### 构建选项

1. **从项目根目录构建**（推荐）：

   ```bash
   # 构建 WASM 并自动复制到 Chrome 扩展
   npm run build:wasm
   ```

2. **只构建 WASM 包**：

   ```bash
   # 从 packages/wasm-simd 目录
   npm run build

   # 或者从任何地方使用 pnpm filter
   pnpm --filter @chrome-mcp/wasm-simd build
   ```

3. **开发模式构建**：
   ```bash
   npm run build:dev  # 未优化版本，构建更快
   ```

### 构建产物

构建完成后，在 `pkg/` 目录下会生成：

- `simd_math.js` - JavaScript 绑定
- `simd_math_bg.wasm` - WebAssembly 二进制文件
- `simd_math.d.ts` - TypeScript 类型定义
- `package.json` - NPM 包信息

### 集成到 Chrome 扩展

WASM 文件会自动复制到 `app/chrome-extension/workers/` 目录，Chrome 扩展可以直接使用：

```typescript
// 在 Chrome 扩展中使用
const wasmUrl = chrome.runtime.getURL('workers/simd_math.js');
const wasmModule = await import(wasmUrl);
```

## 🔧 开发工作流

1. 修改 `src/lib.rs` 中的 Rust 代码
2. 运行 `npm run build` 重新构建
3. Chrome 扩展会自动使用新的 WASM 文件

## 📊 性能测试

```bash
# 在 Chrome 扩展中运行基准测试
import { runSIMDBenchmark } from './utils/simd-benchmark';
await runSIMDBenchmark();
```
