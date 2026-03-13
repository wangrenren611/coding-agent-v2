# Agent-V4 CLI 应用层技术文档总览

本目录用于沉淀 `agent-v4` 的应用层实现设计，目标是让 `StatelessAgent` 内核可稳定服务 CLI 场景，并保持无状态架构原则。

## 文档清单（按编号）

- `01-scope-and-goals.md`：目标、范围、非目标、约束
- `02-architecture-overview.md`：总体分层架构与依赖方向
- `03-domain-model-and-contracts.md`：领域模型与核心数据契约
- `04-ports-and-interfaces.md`：应用层 Port 接口定义
- `05-run-orchestration-and-state-machine.md`：执行编排、状态机与时序
- `06-cli-commands-and-ux.md`：CLI 命令与交互规范
- `07-storage-design-local.md`：Phase 1 本地存储设计
- `08-error-and-observability.md`：错误策略、日志、指标、追踪
- `09-security-and-policy-boundary.md`：安全边界与策略层职责
- `10-test-plan-and-acceptance.md`：测试计划与验收标准
- `11-implementation-phases.md`：分阶段实施计划
- `12-open-questions-and-risks.md`：开放问题与风险登记
- `13-sqlite-schema-fields-and-rationale.md`：SQLite 表结构、字段释义与存储理由
- `14-project-flow-mermaid.md`：项目级详细流程图（Mermaid）

## 使用方式

1. 先阅读 `01` 到 `05`，统一架构和执行语义。
2. 再阅读 `06` 到 `09`，明确 CLI 落地方式与运维安全边界。
3. 使用 `10` 和 `11` 驱动开发计划与验收。
4. `12` 用于实现前对齐决策，避免反复返工。

## 当前状态

- 文档为“可实现级别”的设计稿。
- 默认不改动 `agent-v4` 内核契约。
- 应用层实现应以 Port + Adapter 方式扩展，避免反向侵入内核。
## 补充文档

- `15-openclaw-style-project-blueprint.md`：说明如何在 `agent-v4` 之上实现一个类似 OpenClaw 的网关化、多渠道、插件化系统。
