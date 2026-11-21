// §9.3 /api/analyze stream: blocks of `event: <name>` + one single-line JSON `data:`, separated by a blank line.
export type StageName = 'fetch' | 'watch' | 'physics' | 'score' | 'locate' | 'verdict'
export type StageEvent = { stage: StageName; status: 'start' | 'done' | 'skipped' | 'error'; ms: number | null; summary: string | null }
export type StreamEvent =
  | { event: 'stage'; data: StageEvent }
  | { event: 'result'; data: unknown }
  | { event: 'error'; data: { stage: StageName; message: string } }

/** Parse one block ("event: x\ndata: {...}"). Unknown or malformed blocks → null. */
export function parseBlock(block: string): StreamEvent | null {
  let event = '', data = ''
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!['stage', 'result', 'error'].includes(event) || !data) return null
  try { return { event, data: JSON.parse(data) } as StreamEvent } catch { return null }
}

/** Read a fetch body (not EventSource: the request is a POST) and emit each event as it arrives. */
export async function readStream(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<void> {
  const reader = body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    buf += dec.decode(value ?? new Uint8Array(), { stream: !done })
    const blocks = buf.split(/\r?\n\r?\n/)
    buf = done ? '' : blocks.pop()!
    for (const b of blocks) { const e = parseBlock(b); if (e) onEvent(e) }
    if (done) return
  }
}
