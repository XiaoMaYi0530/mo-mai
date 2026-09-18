/** 故事状态包含章节扫描记录和人物卡关联；不得靠隐式依赖覆盖用户未勾选的模块。 */
export function validateStoryStateModuleSelection(
  selected: ReadonlySet<string>,
  storyStateAvailable: boolean
): void {
  if (!selected.has('storyState')) return
  if (!storyStateAvailable) {
    throw new Error('这个旧版归档不包含故事状态，请取消“故事状态与补录”后重试。')
  }
  if (!selected.has('chapters') || !selected.has('characters')) {
    throw new Error('导入故事状态必须同时勾选“章节正文”和“角色与势力”；覆盖导入会替换这两项。')
  }
}
