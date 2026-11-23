# Courseware Workflow {{VERSION}} 发布说明

## 本版本结构

- `skill/courseware-workflow/` 是唯一可编辑的 Skill 源。
- `packaging/plugin/` 只保存插件清单、说明与品牌资源。
- 发布脚本在临时目录生成完整 Skill 与插件目录，再输出两个 ZIP。
- 发布和回归测试脚本不再进入用户项目的运行时。
- `dist/v{{VERSION}}/` 只保存发布产物、当前版本信息与校验文件。

许可证为 MIT，版权声明为 `Copyright (c) 2026 Courseware Workflow Contributors`。第三方课件素材不自动
继承本项目的 MIT 许可。
