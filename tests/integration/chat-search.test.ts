import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeChannel, makeMember, makeMessage } from '../factories'
import { searchMessages } from '@/features/chat/search-service'

describe('search', () => {
  beforeEach(resetDb)

  it('finds by relevance within accessible conversations only', async () => {
    const me = await makeUser()
    const other = await makeUser()
    const mine = await makeChannel({ name: 'mine' })
    const secret = await makeChannel({ name: 'secret' })
    await makeMember(mine.id, me.id)
    await makeMember(secret.id, other.id)
    await makeMessage(mine.id, me.id, { body: 'the CVD furnace maintenance window is Friday' })
    await makeMessage(secret.id, other.id, { body: 'CVD furnace budget approved' })
    const hits = await searchMessages({ userId: me.id, query: 'CVD furnace' })
    expect(hits).toHaveLength(1)
    expect(hits[0].conversationId).toBe(mine.id)
  })

  it('excludes deleted messages, respects cid filter and non-membership', async () => {
    const me = await makeUser()
    const a = await makeChannel()
    const b = await makeChannel()
    await makeMember(a.id, me.id)
    await makeMember(b.id, me.id)
    await makeMessage(a.id, me.id, { body: 'graphene sample ready' })
    await makeMessage(b.id, me.id, { body: 'graphene talk slides' })
    await makeMessage(a.id, me.id, { body: 'graphene deleted note', deletedAt: new Date() })
    expect(await searchMessages({ userId: me.id, query: 'graphene' })).toHaveLength(2)
    expect(await searchMessages({ userId: me.id, query: 'graphene', conversationId: a.id })).toHaveLength(1)
    const stranger = await makeUser()
    expect(await searchMessages({ userId: stranger.id, query: 'graphene' })).toEqual([])
    expect(await searchMessages({ userId: me.id, query: '   ' })).toEqual([])
  })
})
