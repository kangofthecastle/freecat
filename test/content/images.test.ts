import { describe, it, expect } from 'vitest'
import {
  CONTENT_PROTOCOL,
  toContentUrl,
  rewriteImagePaths
} from '../../src/main/content/images'

describe('CONTENT_PROTOCOL', () => {
  it('is the freecat-content scheme', () => {
    expect(CONTENT_PROTOCOL).toBe('freecat-content')
  })
})

describe('toContentUrl', () => {
  it('prefixes a relative path with the protocol', () => {
    expect(toContentUrl('questions/chem-phys/cp-1/figure-1.png')).toBe(
      'freecat-content://questions/chem-phys/cp-1/figure-1.png'
    )
  })
  it('normalizes backslashes to forward slashes', () => {
    expect(toContentUrl('questions\\chem-phys\\cp-1\\figure-1.png')).toBe(
      'freecat-content://questions/chem-phys/cp-1/figure-1.png'
    )
  })
})

describe('rewriteImagePaths', () => {
  const dir = 'questions/chem-phys/cp-1'

  it('rewrites a relative image target to a content URL', () => {
    const out = rewriteImagePaths('![alt](figure-1.png)', dir)
    expect(out).toBe('![alt](freecat-content://questions/chem-phys/cp-1/figure-1.png)')
  })

  it('rewrites multiple relative targets', () => {
    const md = 'a ![one](a.png) b ![two](sub/b.png)'
    const out = rewriteImagePaths(md, dir)
    expect(out).toContain('freecat-content://questions/chem-phys/cp-1/a.png')
    expect(out).toContain('freecat-content://questions/chem-phys/cp-1/sub/b.png')
  })

  it('leaves http(s) URLs untouched', () => {
    const md = '![x](https://example.com/i.png)'
    expect(rewriteImagePaths(md, dir)).toBe(md)
  })

  it('leaves absolute paths untouched', () => {
    const md = '![x](/already/abs.png)'
    expect(rewriteImagePaths(md, dir)).toBe(md)
  })

  it('leaves data: URIs untouched', () => {
    const md = '![x](data:image/png;base64,iVBORw0KGgo=)'
    expect(rewriteImagePaths(md, dir)).toBe(md)
  })

  it('leaves an already-rewritten content URL untouched', () => {
    const md = '![x](freecat-content://questions/chem-phys/cp-1/a.png)'
    expect(rewriteImagePaths(md, dir)).toBe(md)
  })

  it('does not touch prose without images', () => {
    const md = 'Just text with (parentheses) and a [link](https://x.com).'
    expect(rewriteImagePaths(md, dir)).toBe(md)
  })
})
