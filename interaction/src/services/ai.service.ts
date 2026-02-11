import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'
import { anthropic } from '@ai-sdk/anthropic'

const providers = {
  openai,
  google,
  anthropic,
}

export const getResponse = async (prompt: string, provider: keyof typeof providers = 'openai') => {
  const model = providers[provider]('gpt-4o') // simplified model selection
  const { text } = await generateText({
    model,
    prompt,
  })
  return text
}
