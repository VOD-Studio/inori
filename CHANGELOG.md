# Changelog

## [0.2.3](https://github.com/VOD-Studio/inori/compare/v0.2.2...v0.2.3) (2026-08-18)


### 新增

* paths_ignore 整体跳过纯 CI/文档类变更的评审 ([#15](https://github.com/VOD-Studio/inori/issues/15)) ([0a723c9](https://github.com/VOD-Studio/inori/commit/0a723c949096bc9561722f1fe326119ce6e3d946))

## [0.2.2](https://github.com/VOD-Studio/inori/compare/v0.2.1...v0.2.2) (2026-08-18)


### 修复

* **ci:** 修复 major 浮动 tag 的重复 v 前缀 ([3c3a35e](https://github.com/VOD-Studio/inori/commit/3c3a35edb3b5513cfb8c5a2f6d44bb22c171b05d))

## [0.2.1](https://github.com/VOD-Studio/inori/compare/v0.2.0...v0.2.1) (2026-08-18)


### 修复

* **ci:** 修复发版链路的 manifest 格式冲突与浮动 tag 缺失 ([e983a6a](https://github.com/VOD-Studio/inori/commit/e983a6a7a57ff91352cd4246ca4b80a2bc48cbbc))

## [0.2.0](https://github.com/VOD-Studio/inori/compare/v0.1.0...v0.2.0) (2026-08-18)


### 新增

* prompt 收口纪律、diff 安全截断、配置文件支持、智能早退及 re-review 管理 ([a190c7c](https://github.com/VOD-Studio/inori/commit/a190c7c85a651a365a32a18e891ae66c30f6070d))
* 增加 on_update 评论策略并在 Action 主流程中接入全部新特性 ([ef73329](https://github.com/VOD-Studio/inori/commit/ef7332978d6b0ed1dfea0b3d82634df3177d5bb2))
* 增加收口纪律、diff安全截断、配置文件解析与智能早退纯逻辑 ([25740a6](https://github.com/VOD-Studio/inori/commit/25740a6d4e049ffaf669387cd922307804ed48cf))
* 支持 Coding Plan 套餐端点（qwen-coding / glm-coding） ([3187a44](https://github.com/VOD-Studio/inori/commit/3187a44d6bf485276585caedef7681ecea6c54bc))
* 支持主流大模型配置自动识别、Coding Plan 深度集成与完全自定义 ([b7a4f0b](https://github.com/VOD-Studio/inori/commit/b7a4f0b59a8eb697bf2678fd39a0b2ce3aef07bf))
* 新增 Gemini 与 Grok 预设（对照 omp 内置目录补缺口） ([03e855d](https://github.com/VOD-Studio/inori/commit/03e855da59c78da78072fb894dc5fbe2cb9be7f3))
* 补齐全部订阅套餐预设（doubao-coding / minimax-token） ([0d0f963](https://github.com/VOD-Studio/inori/commit/0d0f963afe3db4652b39b7bbf2ab3af691840b20))
* 评审更新复用去重（标记清理旧评论+原地更新汇总）、模型名入标题、custom_instructions 输入 ([b78a8ff](https://github.com/VOD-Studio/inori/commit/b78a8ffcebd3dd4438096696997002e654f0700e))


### 修复

* LLM 调用超时/重试/response_format 降级与 JSON 围栏容错 ([f211a33](https://github.com/VOD-Studio/inori/commit/f211a33e393dfdaa4c6390084916653e83becede))
* 修复 coding_plan 类型漂移崩溃并解耦模型选择设计 ([38d9034](https://github.com/VOD-Studio/inori/commit/38d903492083f87240494d9a9bc3f22f2a5b4e63))
* 修复 runner default 遮蔽并收窄 bot 识别 ([88b7a32](https://github.com/VOD-Studio/inori/commit/88b7a325f5448f1e640ecb4e23a075d72b30e8fd))
* 全量核验 24 家 provider 预设（官方文档逐家查证） ([7c05bad](https://github.com/VOD-Studio/inori/commit/7c05bade480c2ea75e0f21c78362e0ffddee7a8e))
* 对照官方文档核验并修正 provider 预设快照 ([0538ff3](https://github.com/VOD-Studio/inori/commit/0538ff311ef10d23a5c5c90aadb903f30c015b21))


### 重构

* 分层架构重构 ([08399d2](https://github.com/VOD-Studio/inori/commit/08399d2e2133cd56e356123101bb5e25897a181a))
* 删除长尾 provider 预设，聚焦主流（28 → 22） ([68ed4ef](https://github.com/VOD-Studio/inori/commit/68ed4efd1984e8637e10a8633abd70763500afee))
* 抽离纯逻辑到 src/logic.ts 并修复 parseReviews null 崩溃 ([cdcce90](https://github.com/VOD-Studio/inori/commit/cdcce9078ebfe6e46e009966893ee17e56fd14c7))

