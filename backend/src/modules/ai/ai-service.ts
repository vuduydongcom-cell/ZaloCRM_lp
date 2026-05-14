import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { getProviderConfig, getAvailableProviders } from './provider-registry.js';
import { generateWithAnthropic } from './providers/anthropic.js';
import { generateWithGemini } from './providers/gemini.js';
import { generateWithOpenaiCompat } from './providers/openai-compat.js';
import { buildReplyDraftPrompt } from './prompts/reply-draft.js';
import { buildSummaryPrompt } from './prompts/summary.js';
import { buildSentimentPrompt } from './prompts/sentiment.js';

export type AiTaskType = 'reply_draft' | 'summary' | 'sentiment';

type MessageContext = { senderType: string; senderName: string | null; content: string | null; sentAt: Date };
type SentimentResult = { label: 'positive' | 'neutral' | 'negative'; confidence: number; reason: string };

function detectLanguage(text: string): 'vi' | 'en' {
  if (/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text)) return 'vi';
  const vietnameseHints = [' khách ', ' chào ', ' tư vấn ', ' báo giá ', ' sản phẩm ', ' giúp ', ' nhé ', ' không '];
  return vietnameseHints.some((hint) => (` ${text.toLowerCase()} `).includes(hint)) ? 'vi' : 'en';
}

function escapeXmlBoundary(text: string): string {
  return text.replace(/<\/?conversation_context>/gi, '');
}

function buildConversationContext(messages: MessageContext[]) {
  return messages
    .map((msg) => {
      const author = msg.senderType === 'self' ? 'staff' : (msg.senderName || 'customer');
      const content = escapeXmlBoundary(msg.content || '(empty)');
      return `[${msg.sentAt.toISOString()}] ${author}: ${content}`;
    })
    .join('\n');
}

async function getProviderApiKey(orgId: string, provider: string) {
  /* 1. Check registry (env-based) */
  const providerDef = getProviderConfig(provider);
  if (providerDef?.authToken) return providerDef.authToken;

  /* 2. Fallback: per-org DB setting */
  const setting = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: `ai_${provider}_api_key` },
  });
  return setting?.valuePlain || '';
}

export async function getAiConfig(orgId: string) {
  let aiConfig = await prisma.aiConfig.findUnique({ where: { orgId } });
  if (!aiConfig) {
    aiConfig = await prisma.aiConfig.create({
      data: { orgId, provider: config.aiDefaultProvider, model: config.aiDefaultModel, maxDaily: 500, enabled: true },
    });
  }
  const availableProviders = getAvailableProviders();
  const hasKey = async (p: string) => !!(await getProviderApiKey(orgId, p));
  const [hasAnthropicKey, hasGeminiKey] = await Promise.all([hasKey('anthropic'), hasKey('gemini')]);
  return { ...aiConfig, hasAnthropicKey, hasGeminiKey, availableProviders };
}

export async function updateAiConfig(orgId: string, input: { provider?: string; model?: string; maxDaily?: number; enabled?: boolean }) {
  return prisma.aiConfig.upsert({
    where: { orgId },
    create: {
      orgId,
      provider: input.provider || config.aiDefaultProvider,
      model: input.model || config.aiDefaultModel,
      maxDaily: input.maxDaily ?? 500,
      enabled: input.enabled ?? true,
    },
    update: {
      provider: input.provider,
      model: input.model,
      maxDaily: input.maxDaily,
      enabled: input.enabled,
    },
  });
}

export async function getAiUsage(orgId: string) {
  const currentConfig = await getAiConfig(orgId);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const usedToday = await prisma.aiSuggestion.count({ where: { orgId, createdAt: { gte: startOfDay } } });
  return {
    usedToday,
    maxDaily: currentConfig.maxDaily,
    remaining: Math.max(0, currentConfig.maxDaily - usedToday),
    enabled: currentConfig.enabled,
  };
}

async function loadConversation(conversationId: string, orgId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    include: {
      contact: { select: { fullName: true } },
      messages: {
        where: { isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: 40,
        select: { senderType: true, senderName: true, content: true, sentAt: true },
      },
    },
  });
  if (!conversation) throw new Error('Conversation not found');
  return { ...conversation, messages: [...conversation.messages].reverse() };
}

async function generateText(provider: string, apiKey: string, model: string, system: string, prompt: string) {
  const providerDef = getProviderConfig(provider);
  const baseUrl = providerDef?.baseUrl || '';

  if (provider === 'anthropic') return generateWithAnthropic(baseUrl, apiKey, model, system, prompt);
  if (provider === 'gemini') return generateWithGemini(baseUrl, apiKey, model, system, prompt);

  /* OpenAI, Qwen, Kimi all use OpenAI-compatible chat/completions API */
  if (provider === 'openai') return generateWithOpenaiCompat(`${baseUrl}/v1/chat/completions`, apiKey, model, system, prompt);
  if (provider === 'qwen') return generateWithOpenaiCompat(`${baseUrl}/compatible-mode/v1/chat/completions`, apiKey, model, system, prompt);
  if (provider === 'kimi') return generateWithOpenaiCompat(`${baseUrl}/v1/chat/completions`, apiKey, model, system, prompt);

  throw new Error(`Unsupported AI provider: ${provider}`);
}

async function saveSuggestion(input: { orgId: string; conversationId: string; messageId?: string; type: AiTaskType; content: string; confidence: number }) {
  return prisma.aiSuggestion.create({
    data: {
      orgId: input.orgId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      confidence: input.confidence,
    },
  });
}

export async function generateAiOutput(input: { orgId: string; conversationId: string; type: AiTaskType; messageId?: string }) {
  const [currentConfig, conversation] = await Promise.all([
    getAiConfig(input.orgId),
    loadConversation(input.conversationId, input.orgId),
  ]);

  if (!currentConfig.enabled) throw new Error('AI is disabled for this organization');

  // Atomic quota check — count inside transaction to prevent TOCTOU race
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const withinQuota = await prisma.$transaction(async (tx) => {
    const usedToday = await tx.aiSuggestion.count({ where: { orgId: input.orgId, createdAt: { gte: startOfDay } } });
    return usedToday < currentConfig.maxDaily;
  });
  if (!withinQuota) throw new Error('AI daily quota exceeded');

  const apiKey = await getProviderApiKey(input.orgId, currentConfig.provider);
  if (!apiKey) throw new Error('AI provider key is not configured');

  const contextText = buildConversationContext(conversation.messages);
  const language = detectLanguage(contextText);
  const customerName = conversation.contact?.fullName || 'customer';
  const userPrompt = [
    `<conversation_context>`,
    `Customer: ${customerName}`,
    contextText,
    `</conversation_context>`,
  ].join('\n');

  const system = input.type === 'reply_draft'
    ? buildReplyDraftPrompt(language)
    : input.type === 'summary'
      ? buildSummaryPrompt(language)
      : buildSentimentPrompt(language);

  const raw = await generateText(currentConfig.provider, apiKey, currentConfig.model, system, userPrompt);

  if (input.type === 'sentiment') {
    let parsed: SentimentResult;
    try {
      parsed = JSON.parse(raw) as SentimentResult;
    } catch {
      parsed = { label: 'neutral', confidence: 0.4, reason: raw };
    }
    const normalized = {
      label: ['positive', 'negative', 'neutral'].includes(parsed.label) ? parsed.label : 'neutral',
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0.4,
      reason: parsed.reason || raw,
    };
    await saveSuggestion({
      orgId: input.orgId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      type: 'sentiment',
      content: JSON.stringify(normalized),
      confidence: normalized.confidence,
    });
    return normalized;
  }

  const text = raw.trim();
  await saveSuggestion({
    orgId: input.orgId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    type: input.type,
    content: text,
    confidence: 0.8,
  });
  return { content: text, confidence: 0.8 };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Parse a free-form note ("Thứ 6 gọi lại khách", "3 ngày nữa nhắn tin chốt giá")
 * into a structured appointment proposal. Returns null if AI can't find a clear
 * date/time intent — caller falls back to manual create.
 * ────────────────────────────────────────────────────────────────────────── */
export type ParsedAppointment = {
  date: string | null;       // YYYY-MM-DD
  time: string | null;       // HH:MM (24h)
  type: string | null;       // 'call' | 'message' | 'meeting' | 'follow_up' | null
  summary: string;           // tiêu đề ngắn cho lịch hẹn
  confidence: number;        // 0..1
};

export async function parseAppointmentFromText(input: { orgId: string; text: string; now?: Date }): Promise<ParsedAppointment | null> {
  const currentConfig = await getAiConfig(input.orgId);
  if (!currentConfig.enabled) throw new Error('AI is disabled for this organization');
  const apiKey = await getProviderApiKey(input.orgId, currentConfig.provider);
  if (!apiKey) throw new Error('AI provider key is not configured');

  const now = input.now || new Date();
  const today = now.toISOString().slice(0, 10);
  const weekday = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][now.getDay()];

  const system = [
    'You parse a Vietnamese CRM note into an appointment proposal. Return STRICT JSON ONLY, no prose.',
    'Output schema:',
    '{ "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "type": "call"|"message"|"meeting"|"follow_up"|null, "summary": string, "confidence": number_0_to_1 }',
    'Rules:',
    `- Hôm nay là ${today} (${weekday}). Tính ngày tuyệt đối cho "thứ X" (sang tuần tới nếu thứ đã qua), "N ngày nữa", "tuần sau", "tháng sau", "mai", "kia".`,
    '- "gọi"/"call" → type=call. "nhắn tin"/"message" → type=message. "gặp"/"meeting" → type=meeting. Mặc định → follow_up.',
    '- Nếu không có giờ rõ ràng, time=null. Nếu nói "sáng"=09:00, "chiều"=14:00, "tối"=19:00.',
    '- summary: 1 câu ngắn ≤80 ký tự mô tả việc cần làm (vd: "Gọi lại khách hỏi báo giá").',
    '- Nếu KHÔNG có ý định hẹn rõ ràng (chỉ là note thông thường), trả {"date":null,"time":null,"type":null,"summary":"","confidence":0}.',
    '- Confidence > 0.5 chỉ khi date hoặc time được suy luận chắc chắn.',
  ].join('\n');

  const userPrompt = `<note>\n${escapeXmlBoundary(input.text)}\n</note>\nReturn JSON only.`;
  const raw = await generateText(currentConfig.provider, apiKey, currentConfig.model, system, userPrompt);

  // Strip code fences if model wrapped JSON in ```json ... ```
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: Partial<ParsedAppointment>;
  try {
    parsed = JSON.parse(cleaned) as Partial<ParsedAppointment>;
  } catch {
    return null;
  }
  const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence as number)) : 0;
  if (confidence < 0.3 && !parsed.date) return null;

  const validType = parsed.type && ['call', 'message', 'meeting', 'follow_up'].includes(parsed.type) ? parsed.type : null;
  const dateOk = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date);
  const timeOk = parsed.time && /^\d{2}:\d{2}$/.test(parsed.time);

  return {
    date: dateOk ? parsed.date! : null,
    time: timeOk ? parsed.time! : null,
    type: validType,
    summary: (parsed.summary || '').slice(0, 200),
    confidence,
  };
}
