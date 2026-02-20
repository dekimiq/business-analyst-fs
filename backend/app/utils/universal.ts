export function chunkArray(arr: unknown[], chunkSize: number): unknown[][] {
  const chunks: unknown[][] = []
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize))
  }

  return chunks
}
