import rawTutorial from '../../../../tutorial.json'
import { normalizeTutorial, type TutorialDocument } from './tutorials-core'

export * from './tutorials-core'

export const LOCAL_TUTORIAL: TutorialDocument = normalizeTutorial(rawTutorial) ?? {
  version: 1,
  updatedAt: '',
  title: '墨脉使用教程',
  intro: '',
  resources: []
}
