import { describe, expect, it } from 'vitest'
import { readStream, type StreamEvent } from './sse'

// The §9.3 example body, split at awkward places like a real network would.
const BODY = [
  'event: stage\ndata: {"stage":"fetch","status":"start","ms":null,"summary":null}\n\n',
  'event: stage\ndata: {"stage":"fetch","status":"done","ms":2100,"summary":"48 s clip"}\n\nevent: st',
  'age\ndata: {"stage":"locate","status":"skipped","ms":null,"summary":"rejected clips are not located"}\n\n',
  'event: result\ndata: {"clip_id":"c_0187","fake":{"verdict":"fake"}}\n',
]

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close() },
})

describe('readStream', () => {
  it('emits stage events in order and the final result, across chunk boundaries', async () => {
    const got: StreamEvent[] = []
    await readStream(stream(BODY), (e) => got.push(e))
    expect(got.map((e) => e.event)).toEqual(['stage', 'stage', 'stage', 'result'])
    expect(got[2]).toMatchObject({ data: { stage: 'locate', status: 'skipped' } })
    expect(got[3]).toMatchObject({ data: { clip_id: 'c_0187' } })
  })
  it('passes an error event through', async () => {
    const got: StreamEvent[] = []
    await readStream(stream(['event: error\ndata: {"stage":"watch","message":"quota"}\n\n']), (e) => got.push(e))
    expect(got).toEqual([{ event: 'error', data: { stage: 'watch', message: 'quota' } }])
  })
})
