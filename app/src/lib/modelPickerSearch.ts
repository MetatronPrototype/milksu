export type SearchableModelOption = {
  value: string
  label: string
  model: string
  disabled?: boolean
  title?: string
}

export type SearchableModelGroup = {
  key: string
  label: string
  models: SearchableModelOption[]
}

export function filterSearchableModelGroups(
  groups: readonly SearchableModelGroup[],
  query: string,
): SearchableModelGroup[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return groups.map(group => ({ ...group, models: group.models.slice() }))
  return groups.flatMap(group => {
    if (group.label.toLocaleLowerCase().includes(normalized)) {
      return [{ ...group, models: group.models.slice() }]
    }
    const models = group.models.filter(model => (
      model.label.toLocaleLowerCase().includes(normalized)
      || model.model.toLocaleLowerCase().includes(normalized)
    ))
    return models.length ? [{ ...group, models }] : []
  })
}

export function filterSearchableModelOptions(
  options: readonly SearchableModelOption[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return options.slice()
  return options.filter(option => (
    option.label.toLocaleLowerCase().includes(normalized)
    || option.model.toLocaleLowerCase().includes(normalized)
  ))
}
