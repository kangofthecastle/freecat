import { eq, isNull } from 'drizzle-orm'
import type { DB } from '../db/client'
import { taxonomyNode, type TaxonomyNode } from '../db/schema'

export async function listAll(db: DB): Promise<TaxonomyNode[]> {
  return db.select().from(taxonomyNode)
}

export async function listSections(db: DB): Promise<TaxonomyNode[]> {
  return db.select().from(taxonomyNode).where(isNull(taxonomyNode.parentId))
}

export async function getByCode(db: DB, code: string): Promise<TaxonomyNode | undefined> {
  const [node] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.code, code)).limit(1)
  return node
}

export async function getChildren(db: DB, parentId: string): Promise<TaxonomyNode[]> {
  return db.select().from(taxonomyNode).where(eq(taxonomyNode.parentId, parentId))
}
