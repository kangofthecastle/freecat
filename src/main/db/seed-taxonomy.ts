import type { DB } from './client'
import { taxonomyNode } from './schema'
import { taxonomySeed } from './taxonomy-seed-data'

// Idempotent: re-running seeds the same rows via upsert keyed on the stable id.
export async function seedTaxonomy(db: DB): Promise<void> {
  for (const node of taxonomySeed) {
    await db
      .insert(taxonomyNode)
      .values(node)
      .onConflictDoUpdate({
        target: taxonomyNode.id,
        set: { kind: node.kind, code: node.code, title: node.title, parentId: node.parentId }
      })
  }
}
