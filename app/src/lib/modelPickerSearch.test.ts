import { describe, expect, it } from 'vitest'
import { filterSearchableModelGroups, filterSearchableModelOptions } from '@/lib/modelPickerSearch'

const groups = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    models: [
      { value: 'flash', label: 'DeepSeek Flash', model: 'deepseek-flash' },
      { value: 'pro', label: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro' },
    ],
  },
  {
    key: 'openai',
    label: 'OpenAI',
    models: [
      { value: 'gpt', label: 'GPT-5.6', model: 'gpt-5.6' },
    ],
  },
]

describe('searchable model picker', () => {
  it('keeps a vendor group when the group label matches', () => {
    const next = filterSearchableModelGroups(groups, 'deep')
    expect(next).toHaveLength(1)
    expect(next[0]?.models).toHaveLength(2)
  })

  it('filters models inside a group and drops empty vendors', () => {
    const next = filterSearchableModelGroups(groups, '5.6')
    expect(next).toEqual([
      expect.objectContaining({
        key: 'openai',
        models: [expect.objectContaining({ value: 'gpt' })],
      }),
    ])
  })

  it('filters leading options such as Default / inherit', () => {
    const options = [
      { value: 'auto', label: 'Default DeepSeek Flash', model: 'deepseek-flash' },
      { value: 'inherit', label: 'Follow current conversation', model: '' },
    ]
    expect(filterSearchableModelOptions(options, 'follow')).toEqual([
      expect.objectContaining({ value: 'inherit' }),
    ])
  })
})
