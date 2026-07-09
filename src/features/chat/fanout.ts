import 'server-only'
import type { Message, Conversation } from '@prisma/client'

// Stub — Task 6 replaces this with real notification/push fan-out.
export async function fanoutMessage(_args: { message: Message; conversation: Conversation; senderName: string }): Promise<void> {}
