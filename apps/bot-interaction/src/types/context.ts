import type { Context, SessionFlavor } from 'grammy'
import type { SessionData } from './session.ts'

export type BotContext = Context & SessionFlavor<SessionData>
