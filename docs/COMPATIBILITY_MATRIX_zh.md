# Tabrix 兼容性矩阵

本文档说明 Tabrix 当前对 MCP 客户端和常见环境的公开兼容性口径。

## 兼容性标签说明

| 标签 | 含义 |
| --- | --- |
| `Primary` | 当前公开主链路，文档会重点覆盖 |
| `Supported` | 按公开配置路径预期可用 |
| `Cautious` | 理论上可接入，但更依赖环境或额外验证 |

## MCP 客户端兼容性

| 客户端 / 接入面 | 传输方式 | 状态 | 说明 |
| --- | --- | --- | --- |
| Claude Desktop | Streamable HTTP | `Primary` | 当前重点文档化的客户端路径之一 |
| Cursor | Streamable HTTP | `Primary` | 当前重点文档化的客户端路径之一 |
| Claude Code CLI | HTTP 配置路径 | `Primary` | 命令式接入路径清晰 |
| Codex CLI | HTTP 配置路径 | `Supported` | 已有公开配置说明 |
| Cherry Studio | Streamable HTTP | `Supported` | 已有公开配置说明 |
| Windsurf | Streamable HTTP | `Supported` | 已有公开配置说明 |
| Dify | Streamable HTTP | `Supported` | 需要根据部署环境注意 host 地址 |
| 其他支持 Streamable HTTP 的 MCP 客户端 | Streamable HTTP | `Supported` | 只要遵循标准 MCP URL 配置，通常都可接入 |
| 仅 stdio 或强定制客户端环境 | `stdio` | `Cautious` | 公开上很重要，但不同客户端接入差异更大 |

## 平台兼容性

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows | `Primary` | 当前主要公开验证基线 |
| macOS | `Supported` | 原理上支持，但仍建议补真实机器验证 |
| Ubuntu / Linux | `Supported` | 原理上支持，但仍建议补真实机器验证 |

## 浏览器兼容性

| 浏览器 | 状态 | 说明 |
| --- | --- | --- |
| Chrome | `Primary` | 当前主产品面 |
| Chromium | `Supported` | 在可探测和可配置条件下支持 |

## 使用建议

- 首次成功优先走公开文档中的 `Streamable HTTP` 主路径
- 当前最强公开验证基线仍然是 Windows
- 更细的环境判断要结合 `TESTING_zh.md` 和 `PLATFORM_SUPPORT_zh.md`

## 相关文档

- `CLIENT_CONFIG_QUICKREF.md`
- `STABLE_QUICKSTART.md`
- `PLATFORM_SUPPORT_zh.md`
- `TESTING_zh.md`
