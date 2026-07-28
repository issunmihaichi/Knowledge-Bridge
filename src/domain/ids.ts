export function newId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint32Array(2))
  return `${prefix}_${Date.now().toString(36)}${random[0].toString(36)}${random[1].toString(36)}`
}
