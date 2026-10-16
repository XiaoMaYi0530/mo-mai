# 图文教程维护说明

## 文件与入口

- `docs/user-guide.md`：教程正文，GitHub 与 Markdown 编辑器可直接阅读。
- `docs/assets/tutorial/`：当前版本真实界面截图，README 与教程共用。
- `README.md`：顶部教程链接和截图画廊。
- `tutorial.json`：应用“使用教程”菜单及远程教程配置。

本轮使用 **Playwright + Electron** 拍摄本地构建，截图日期为 2026-10-16，对应 `package.json` 的 v1.22.44。演示作品、正文及参考分析由教程作者预置，没有调用付费模型生成结果；教程已标明示例性质。

## 更新步骤

1. 构建需要说明的版本，使用独立 Electron 应用数据目录和独立 `CHARACTERARC_WORKSPACE_DIR`，避免载入作者的真实作品、接口密钥和会话。
2. 创建少量原创演示作品，填入人物、世界观、分卷、大纲和正文。参考分析使用人工示例时，必须在教程中说明。
3. 用 Playwright 操作当前界面并截图，统一浅色主题；常规页面使用 1440 × 960 的逻辑视口，较长弹窗可增加高度，数值规则与战斗试算使用“展开数值管理”宽面板。确保表单标题、主要操作和状态可读，等待动画、加载与临时提示结束。
4. 不用设计稿、拼图或生成图片代替真实应用界面；没有运行 AI 时，不制作虚假的成功回执。
5. 更新教程步骤与按钮名称，核对功能边界。尤其检查多本参考、文风绑定、节点与章节移动范围、AI 修改确认和数值公式。
6. 同步更新 README 引用及 `tutorial.json` 的日期。若修改教程地址，运行现有教程配置测试。
7. 检查所有图片、相对链接和目录锚点，再以 Markdown 预览检查图片显示。将正文、图片和入口配置一起提交，避免在线入口先于文档发布。

## 截图索引

| 文件 | 内容 |
|---|---|
| `01-projects.png` | 项目中心 |
| `02-overview.png` | 作品概览 |
| `03-outline.png` | 剧情大纲 |
| `04-story-data.png` | 故事资料与人物 |
| `05-chapters.png` | 章节编辑器与 AI 助理 |
| `06-references.png` | 拆书知识库 |
| `07-skills.png` | 全局 Skill 设置 |
| `08-cover.png` | 封面工作台 |
| `09-reference-create.png` | 多本参考分工与骨架创建入口 |
| `10-direct-create.png` | 跳过骨架与复制世界观 |
| `11-outline-move.png` | 批量移动大纲节点 |
| `12-game-setup.png` | 游戏数值档案与装备栏 |
| `13-game-rules.png` | 属性精度与战斗规则版本 |
| `14-settings.png` | AI 接口配置 |
| `15-backup.png` | 存储、导出与备份 |
| `16-equipment.png` | 原创装备生成器 |
| `17-new-project.png` | 新建作品向导 |
| `18-game-attributes.png` | 人物属性面板 |
| `19-combat-skill.png` | 网游数值战斗写作 Skill |
| `20-combat-preview.png` | 双方战斗试算与伤害暂存 |

## 发布说明

README 使用仓库相对链接，本地即可查看。应用菜单使用 GitHub `main` 分支的在线地址，需将本轮文档与图片发布到该分支后才能访问新版内容。本轮更新文档与入口配置，不代表已推送仓库或重新制作安装包。
