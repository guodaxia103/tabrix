# Tabrix 生产依赖安全审计门禁（OSV 方案）

## 1. 背景

Tabrix 原先使用：

```bash
pnpm audit --prod --audit-level high
```

作为仓库的生产依赖安全门禁。

后续 npm 旧审计接口退役，`pnpm audit` 在 CI 中会命中：

- `https://registry.npmjs.org/-/npm/v1/security/audits`
- 返回 `410 Gone`

这类失败不是业务代码问题，而是上游审计端点失效。

如果只是把错误吞掉，例如：

```bash
pnpm audit --ignore-registry-errors
```

虽然能让 CI 重新变绿，但本质上只是**临时止血**：

- CI 不再阻塞
- 但真实的安全门禁已经失效

Tabrix 当前采用的正式替代方案，是把审计门禁切换到 **OSV 官方接口**。

---

## 2. 当前实现

当前仓库的 `audit` 脚本为：

```bash
node ./scripts/audit-prod.mjs
```

对应实现文件：

- [`scripts/audit-prod.mjs`](../scripts/audit-prod.mjs)

它的工作流程是：

1. 执行 `pnpm list -r --prod --json --depth Infinity`
2. 提取整个 monorepo 的**生产依赖树**
3. 过滤掉非外部依赖，例如：
   - `workspace:`
   - `link:`
   - `file:`
4. 把唯一的 `npm package + version` 组合整理成查询批次
5. 调用 OSV 批量接口：
   - `POST https://api.osv.dev/v1/querybatch`
6. 对返回的 advisory id 再拉取详情：
   - `GET https://api.osv.dev/v1/vulns/<id>`
7. 只把 `HIGH / CRITICAL` 级别漏洞视为真正阻塞
8. 如果发现高危，则 `audit` 非零退出，CI 失败

---

## 3. 为什么选 OSV

选择 OSV 的原因：

1. **官方公共接口稳定**
   - 不依赖已退役的 npm 旧审计端点

2. **适合 monorepo**
   - 我们可以先从 `pnpm list` 得到完整生产依赖树
   - 再统一做批量查询

3. **结果足够结构化**
   - 能拿到 advisory id
   - 能拿到 summary
   - 能拿到 `database_specific.severity`

4. **可控**
   - 审计逻辑在仓库内
   - 后续调整严重级别门槛、排除策略、输出格式，都不再受 `pnpm audit` 黑盒行为影响

---

## 4. 当前门禁语义

当前门禁的真实含义是：

- 只检查**生产依赖**
- 只阻塞 `HIGH / CRITICAL`
- `MODERATE / LOW` 仅记录，不阻塞

这和仓库以前的意图是一致的：

- 不让低优先级噪音把 CI 全部打红
- 但高危漏洞仍然必须阻塞发版与主线提交

---

## 5. 当前方案的边界

这套方案已经比“忽略 registry 错误”强很多，但仍然有边界：

1. **依赖 OSV 可用性**
   - 如果 OSV API 本身不可用，`audit` 仍会失败
   - 这是合理的，因为审计门禁本来就不可假通过

2. **严重级别依赖 advisory 元数据**
   - 当前主要使用 `database_specific.severity`
   - 如果未来需要更细粒度门槛，可以进一步解析 CVSS

3. **只看生产依赖**
   - 与现有发布门禁一致
   - 如果未来要扩展到 devDependencies，应明确分开，不要直接改变当前语义

---

## 6. 维护规则

后续维护这套审计门禁时，默认遵守以下规则：

1. **先修真实门禁，再谈临时降级**
   - 不允许把“吞掉错误”当成最终修复

2. **不要静默放宽门槛**
   - 如果从 `HIGH` 改成 `CRITICAL`
   - 或从生产依赖扩大/缩小范围
   - 必须同步说明原因

3. **先确认失败来源**
   - 是业务依赖真的有漏洞
   - 还是上游审计接口 / 网络 / 证书问题

4. **保留单一真相源**
   - `package.json` 的 `audit` 脚本
   - `scripts/audit-prod.mjs`
   - 这两处必须保持一致

---

## 7. 后续可选增强

如果后续要继续增强，这几个方向是合理的：

1. 输出更友好的 Markdown 报告
2. 支持 advisory allowlist（仅在用户明确批准后）
3. 支持把 `MODERATE` 作为非阻塞告警输出到 CI summary
4. 加一条专门测试，验证：
   - 生产依赖提取逻辑
   - `workspace/link/file` 依赖不会误入审计集合

---

## 8. 一句话结论

Tabrix 现在的安全审计门禁已经从：

- “依赖退役 npm 审计端点”

升级为：

- “基于 OSV 官方接口的真实生产依赖高危门禁”

这不是临时止血，而是当前仓库可持续维护的正式方案。
