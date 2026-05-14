<template>
  <section class="notes-section">
    <!-- Header -->
    <div class="notes-header">
      <div class="notes-title">
        📝 Ghi chú
        <span v-if="rootCount" class="notes-count">#{{ rootCount }}</span>
      </div>
      <button v-if="!composerOpen" class="notes-add-btn" @click="openComposer(null)">
        + Thêm ghi chú
      </button>
    </div>

    <!-- Composer (root level) -->
    <div v-if="composerOpen && replyTarget === null" class="note-composer">
      <textarea
        ref="composerInput"
        v-model="composerDraft"
        class="note-input"
        placeholder="Ghi chú... (Ctrl+Enter để lưu, Esc để hủy)"
        rows="2"
        @keydown.ctrl.enter.prevent="submitComposer"
        @keydown.meta.enter.prevent="submitComposer"
        @keydown.escape="closeComposer"
      />
      <div class="composer-actions">
        <button class="btn-link" @click="closeComposer">Hủy</button>
        <button class="btn-primary" :disabled="!composerDraft.trim() || saving" @click="submitComposer">
          {{ saving ? 'Đang lưu…' : 'Lưu' }}
        </button>
      </div>
    </div>

    <!-- Scroll area -->
    <div v-if="loading && !notes.length" class="notes-loading">Đang tải…</div>
    <div v-else-if="!notes.length" class="notes-empty">
      <span class="empty-icon">💭</span>
      <p>Chưa có ghi chú. Thử: <em>"Thứ 6 gọi lại khách báo giá"</em> — AI có thể đề xuất lịch hẹn.</p>
    </div>

    <div v-else class="notes-list">
      <article v-for="note in notes" :key="note.id" class="note-card">
        <!-- Root note -->
        <NoteRow
          :note="note"
          :current-user-id="currentUserId"
          @react="onReact"
          @reply="openComposer(note.id)"
          @edit="onEdit"
          @delete="onDelete"
          @ai-parse="onAiParse"
        />

        <!-- AI parse result banner -->
        <div v-if="aiResult.get(note.id)" class="ai-suggestion-banner">
          <template v-if="aiResult.get(note.id)?.date">
            <span class="ai-icon">🤖</span>
            <span class="ai-text">
              Đề xuất:
              <strong>{{ formatAiDate(aiResult.get(note.id)!) }}</strong>
              · {{ aiResult.get(note.id)?.summary }}
            </span>
            <button class="ai-create-btn" :disabled="creatingApt.has(note.id)" @click="createFromAi(note)">
              {{ creatingApt.has(note.id) ? '…' : 'Tạo lịch' }}
            </button>
            <button class="ai-dismiss" title="Bỏ qua" @click="aiResult.delete(note.id)">×</button>
          </template>
          <template v-else>
            <span class="ai-icon">🤖</span>
            <span class="ai-text muted">Không phát hiện thời gian rõ ràng trong ghi chú này.</span>
            <button class="ai-dismiss" @click="aiResult.delete(note.id)">×</button>
          </template>
        </div>

        <!-- Replies (1 level, flat) -->
        <div v-if="note.replies?.length" class="note-replies">
          <NoteRow
            v-for="reply in note.replies"
            :key="reply.id"
            :note="reply"
            :is-reply="true"
            :current-user-id="currentUserId"
            @react="onReact"
            @edit="onEdit"
            @delete="onDelete"
          />
        </div>

        <!-- Reply composer (when this note is the active reply target) -->
        <div v-if="composerOpen && replyTarget === note.id" class="reply-composer">
          <textarea
            ref="composerInput"
            v-model="composerDraft"
            class="note-input small"
            placeholder="Trả lời…"
            rows="2"
            @keydown.ctrl.enter.prevent="submitComposer"
            @keydown.meta.enter.prevent="submitComposer"
            @keydown.escape="closeComposer"
          />
          <div class="composer-actions">
            <button class="btn-link" @click="closeComposer">Hủy</button>
            <button class="btn-primary" :disabled="!composerDraft.trim() || saving" @click="submitComposer">
              {{ saving ? 'Đang gửi…' : 'Gửi' }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useNotes, type Note, type ParsedAppointment } from '@/composables/use-notes';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api/index';
import NoteRow from './NoteRow.vue';

const props = defineProps<{ contactId: string | null }>();

const auth = useAuthStore();
const toast = useToast();
const currentUserId = computed(() => auth.user?.id || '');

const { notes, loading, saving, rootCount, fetch, create, update, remove, toggleReaction, aiParse, linkAppointment } =
  useNotes(() => props.contactId);

const composerOpen = ref(false);
const replyTarget = ref<string | null>(null);
const composerDraft = ref('');
const composerInput = ref<HTMLTextAreaElement | null>(null);

const aiResult = ref(new Map<string, ParsedAppointment>());
const creatingApt = ref(new Set<string>());

watch(() => props.contactId, (id) => {
  composerOpen.value = false;
  composerDraft.value = '';
  aiResult.value.clear();
  if (id) void fetch();
  else notes.value = [];
}, { immediate: true });

function openComposer(parentId: string | null) {
  composerOpen.value = true;
  replyTarget.value = parentId;
  composerDraft.value = '';
  nextTick(() => composerInput.value?.focus());
}

function closeComposer() {
  composerOpen.value = false;
  composerDraft.value = '';
  replyTarget.value = null;
}

async function submitComposer() {
  if (!composerDraft.value.trim()) return;
  const created = await create(composerDraft.value, replyTarget.value);
  if (created) {
    toast.success(replyTarget.value ? 'Đã trả lời' : 'Đã thêm ghi chú');
    closeComposer();
  } else {
    toast.error('Không thể lưu ghi chú');
  }
}

function onReact(noteId: string, emoji: string) {
  if (!currentUserId.value) return;
  void toggleReaction(noteId, emoji, currentUserId.value);
}

async function onEdit(noteId: string, newBody: string) {
  const ok = await update(noteId, newBody);
  if (ok) toast.success('Đã sửa ghi chú');
}

async function onDelete(noteId: string) {
  if (!confirm('Xoá ghi chú này?')) return;
  const ok = await remove(noteId);
  if (ok) toast.success('Đã xoá');
}

async function onAiParse(noteId: string) {
  toast.push('🤖 AI đang phân tích…');
  const parsed = await aiParse(noteId);
  if (parsed) aiResult.value.set(noteId, parsed);
  else aiResult.value.set(noteId, { date: null, time: null, type: null, summary: '', confidence: 0 });
}

function formatAiDate(p: ParsedAppointment): string {
  if (!p.date) return '';
  const d = new Date(`${p.date}T${p.time || '09:00'}:00`);
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const time = p.time ? ` · ${p.time}` : '';
  return `${weekday} ${dd}/${mm}${time}`;
}

async function createFromAi(note: Note) {
  const p = aiResult.value.get(note.id);
  if (!p || !p.date || !props.contactId) return;
  creatingApt.value.add(note.id);
  try {
    const isoDate = p.time
      ? new Date(`${p.date}T${p.time}:00`).toISOString()
      : new Date(`${p.date}T09:00:00`).toISOString();
    const { data } = await api.post('/appointments', {
      contactId: props.contactId,
      appointmentDate: isoDate,
      appointmentTime: p.time || null,
      type: p.type || 'follow_up',
      notes: p.summary || note.body.slice(0, 200),
    });
    const aptId = data.id || data.appointment?.id;
    if (aptId) {
      await linkAppointment(note.id, aptId);
      toast.success('✓ Đã tạo lịch hẹn từ ghi chú');
      aiResult.value.delete(note.id);
    }
  } catch (err) {
    console.error(err);
    toast.error('Không tạo được lịch hẹn');
  } finally {
    creatingApt.value.delete(note.id);
  }
}

defineExpose({ rootCount });
</script>

<style scoped>
.notes-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}
.notes-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--smax-grey-700);
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.notes-count {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
}
.notes-add-btn {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  border: none;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: filter 0.15s;
}
.notes-add-btn:hover { filter: brightness(0.95); }

/* ── Composer ──────────────────────────────────────────────────────────── */
.note-composer, .reply-composer {
  border: 1.5px solid var(--smax-primary, #2962ff);
  border-radius: 8px;
  padding: 6px;
  background: var(--smax-bg, #fff);
}
.reply-composer {
  margin-top: 6px;
  margin-left: 24px;
  border-color: var(--smax-grey-200);
}
.note-input {
  width: 100%;
  border: none;
  outline: none;
  resize: vertical;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  background: transparent;
  color: var(--smax-text);
  min-height: 38px;
}
.note-input.small { font-size: 12px; }

.composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}
.btn-link {
  background: none;
  border: none;
  color: var(--smax-grey-600);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
}
.btn-link:hover { color: var(--smax-grey-800); }
.btn-primary {
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── List / scroll ─────────────────────────────────────────────────────── */
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}
.notes-list::-webkit-scrollbar { width: 5px; }
.notes-list::-webkit-scrollbar-thumb { background: var(--smax-grey-200); border-radius: 3px; }

.note-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.note-replies {
  margin-left: 24px;
  padding-left: 10px;
  border-left: 2px solid var(--smax-grey-100);
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

/* ── States ────────────────────────────────────────────────────────────── */
.notes-loading, .notes-empty {
  padding: 16px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--smax-grey-500);
}
.notes-empty .empty-icon { font-size: 22px; display: block; margin-bottom: 4px; }
.notes-empty em { color: var(--smax-grey-700); font-style: italic; }

/* ── AI suggestion banner ──────────────────────────────────────────────── */
.ai-suggestion-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(90deg, #fff3e0 0%, #fff8e1 100%);
  border: 1px solid #ffb74d;
  border-radius: 7px;
  padding: 6px 10px;
  margin-top: 4px;
  font-size: 12px;
}
.ai-icon { font-size: 14px; }
.ai-text { flex: 1; color: #6d4c00; }
.ai-text.muted { color: var(--smax-grey-500); font-style: italic; }
.ai-text strong { color: #c43a00; }
.ai-create-btn {
  background: #f57c00;
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.ai-create-btn:disabled { opacity: 0.6; }
.ai-dismiss {
  background: none;
  border: none;
  color: var(--smax-grey-500);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
</style>
