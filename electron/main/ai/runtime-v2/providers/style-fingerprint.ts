import type { ContextBuildRequest, ContextSlice } from '@shared/assistant-runtime'
import { buildProjectStyleFingerprintContext } from '@shared/style-fingerprint-binding'
import type { ContextProvider } from '../context-builder'
import { getProjectView, makeSlice, type SnapshotAccessor } from './shared'

export function makeStyleFingerprintProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'style-fingerprint',
    priority: 92,
    truncationHint: '项目风格指纹因上下文预算受限省略。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const snapshot = accessor.getSnapshot()
      const view = getProjectView(snapshot, request.projectId)
      if (!snapshot || !view) return null
      const result = buildProjectStyleFingerprintContext({
        binding: view.project.styleFingerprintBinding,
        fallbackReferenceWorkIds: view.project.selectedReferenceWorkIds,
        referenceWorks: snapshot.referenceWorks,
        documents: snapshot.knowledgeDocuments,
        maxChars: 3200
      })
      if (!result.context) return null
      return makeSlice('style-fingerprint', 92, '项目风格指纹', result.context)
    }
  }
}
