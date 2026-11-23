# Changelog

## 1.0.2

- Replace personally identifying example metadata with a generic contributor.
- Clarify the Main-Agent-first cover subtitle.
- Extend privacy checks for student identifiers in member metadata.

## 1.0.1

- 将可编辑 Skill、插件模板、构建脚本和发布产物分层。
- 插件中的 Skill 副本改为构建时生成，不再维护第二份源码。
- 发布、manifest 和回归测试脚本移出用户安装的 Workflow 运行时。
- 新增统一发布入口 `scripts/release.mjs`，默认执行临时目录验收。
- 清除本地路径、个人署名、会话工作痕迹和账号专用集成说明。
- 增加公开仓库隐私检查与 GitHub Actions 验收。

## 1.0.0

- 发行版本号重置为 1.0.0。
- 发布许可证确定为 MIT。
- 增加第三方内容与生成课件权利的边界说明。
- 发布形式、运行时、CST 三件套和兼容入口与 3.6.0 发布候选一致。
