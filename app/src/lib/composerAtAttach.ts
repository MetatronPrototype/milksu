export function composerAtAttachTrigger(prefix: string) {
  return /(?:^|\s)@$/u.test(prefix)
}
