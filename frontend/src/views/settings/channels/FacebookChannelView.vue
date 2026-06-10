<!--
  FacebookChannelView.vue — "Lead Ads Form" tab.
  Redesigned (2026-06-10) to mirror the Campaign tab layout (plain CSS, .fb-* classes).
  Data source: GET /integrations/facebook/form/status. OAuth flow = 'form'.
  Cross-lock: connect disabled when Campaign is connected (connection-state).
-->
<template>
  <div class="fb-page">
    <header class="fb-head">
      <div class="fb-head-left">
        <div class="fb-icon">f</div>
        <div>
          <h1 class="fb-title">Lead Ads Form</h1>
          <p class="fb-sub">Kết nối Page qua OAuth, nhận lead từ Lead Ads Form về Tệp khách hàng tự động.</p>
        </div>
      </div>
      <div class="fb-head-actions">
        <button class="fb-btn-ghost" @click="configOpen = true">⚙ Cấu hình</button>
        <button
          class="fb-btn-primary"
          :disabled="loading || campaignLocked"
          :title="campaignLocked ? 'Đang kết nối ở tab Campaign — ngắt bên đó trước' : ''"
          @click="onConnect"
        >
          Kết nối Page (OAuth)
        </button>
      </div>
    </header>

    <div v-if="campaignLocked" class="fb-lock-hint">
      ⚠ Đang kết nối ở tab Campaign — ngắt bên đó trước khi kết nối bằng Form.
    </div>

    <!-- Stats 24h -->
    <section v-if="status" class="fb-stats">
      <div class="fb-stat-card">
        <div class="fb-stat-label">Lead nhận 24h</div>
        <div class="fb-stat-val">{{ status.stats24h.received }}</div>
      </div>
      <div class="fb-stat-card ok">
        <div class="fb-stat-label">Đã route</div>
        <div class="fb-stat-val">{{ status.stats24h.processed }}</div>
      </div>
      <div class="fb-stat-card warn">
        <div class="fb-stat-label">Unrouted</div>
        <div class="fb-stat-val">{{ status.stats24h.unrouted }}</div>
      </div>
      <div class="fb-stat-card err">
        <div class="fb-stat-label">Fail</div>
        <div class="fb-stat-val">{{ status.stats24h.failed }}</div>
      </div>
    </section>

    <!-- Webhook URL -->
    <section v-if="status" class="fb-card">
      <div class="fb-card-title">📌 Webhook URL (paste vào Meta App config)</div>
      <div class="fb-row">
        <code class="fb-mono">{{ status.webhookUrl }}</code>
        <button class="fb-btn-ghost" @click="copy(status.webhookUrl)">Copy</button>
      </div>
    </section>

    <!-- OAuth redirect URI -->
    <section v-if="status" class="fb-card">
      <div class="fb-card-title">🔗 OAuth redirect URI (dán vào Meta App → Facebook Login → Valid OAuth Redirect URIs)</div>
      <div class="fb-row">
        <code class="fb-mono">{{ status.oauthRedirectUri }}</code>
        <button class="fb-btn-ghost" @click="copy(status.oauthRedirectUri)">Copy</button>
      </div>
    </section>

    <!-- Pages connected -->
    <section class="fb-card">
      <div class="fb-card-title">📄 Pages đã kết nối ({{ status?.pages?.length ?? 0 }})</div>
      <div v-if="!status?.pages?.length" class="fb-empty">
        Chưa kết nối Page nào. Click "Kết nối Page (OAuth)" để bắt đầu.
      </div>
      <div v-else class="fb-pages-list">
        <div v-for="p in status.pages" :key="p.id" class="fb-page-row">
          <div class="fb-page-info">
            <div class="fb-page-name">{{ p.pageName || `Page ID: ${p.pageId}` }}</div>
            <div class="fb-page-meta">
              ID: <code>{{ p.pageId }}</code> ·
              <span :class="['fb-pill', p.status === 'connected' ? 'ok' : 'off']">
                {{ p.status === 'connected' ? '● Connected' : `○ ${p.status}` }}
              </span>
              · {{ p.formCount }} form
            </div>
          </div>
          <div class="fb-page-actions">
            <button class="fb-btn-danger" :disabled="disconnecting[p.pageId]" @click="onDisconnect(p.pageId, p.pageName || p.pageId)">
              Ngắt kết nối
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Customer Lists -->
    <section class="fb-card">
      <div class="fb-card-title">🗂 Tệp khách hàng</div>
      <div v-if="!status?.lists?.length" class="fb-empty">Chưa có tệp khách hàng nào.</div>
      <table v-else class="fb-table">
        <thead>
          <tr>
            <th>Tệp</th>
            <th style="width:160px">Mã đồng bộ (#)</th>
            <th style="width:80px">KH</th>
            <th style="width:100px">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in status.lists" :key="l.id">
            <td>
              <span class="list-emoji">{{ l.iconEmoji || '📂' }}</span>
              <span class="list-name">{{ l.name }}</span>
            </td>
            <td>
              <code v-if="l.integrationKey" class="fb-mono mini">#{{ l.integrationKey }}</code>
              <span v-else class="fb-empty mini">—</span>
            </td>
            <td>{{ l.totalEntries }}</td>
            <td>
              <span :class="['fb-pill', l.archivedAt ? 'off' : (l.integrationKey ? 'ok' : 'warn')]">
                {{ l.archivedAt ? 'Lưu trữ' : (l.integrationKey ? '✓ Sẵn sàng' : '⚠ Chưa gán') }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Help -->
    <section class="fb-help">
      <details>
        <summary>💡 Cách setup Facebook App + Webhook (OAuth Form)</summary>
        <ol>
          <li>Truy cập <a href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</a> → Create App → Business</li>
          <li>Vào "⚙ Cấu hình" trên màn này → nhập <strong>App ID</strong>, <strong>App Secret</strong>, <strong>Verify Token</strong>, <strong>Token Enc Key</strong> rồi Lưu</li>
          <li>Add Product: <strong>Webhooks</strong> + <strong>Facebook Login</strong></li>
          <li>Facebook Login → Settings → <strong>Valid OAuth Redirect URIs</strong>: dán <code>{{ status?.oauthRedirectUri }}</code></li>
          <li>Webhooks → Page → "Edit Subscriptions"
            <ul>
              <li>Callback URL: <code>{{ status?.webhookUrl }}</code></li>
              <li>Verify Token: trùng với giá trị đã nhập ở "⚙ Cấu hình"</li>
              <li>Subscribe field: <code>leadgen</code></li>
            </ul>
          </li>
          <li>App Review: request permission <code>leads_retrieval</code> + <code>pages_show_list</code> + <code>pages_manage_metadata</code></li>
          <li>Bấm <strong>Kết nối Page (OAuth)</strong> → đăng nhập Facebook → chọn Page → cấp quyền</li>
          <li>Hệ thống tự discover form của Page và map về Tệp khách hàng. Test: submit form test → lead về CRM trong &lt;30s</li>
        </ol>
      </details>
    </section>

    <FacebookConfigModal v-model="configOpen" @saved="onConfigSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from '@/composables/use-toast';
import FacebookConfigModal from '@/components/settings/facebook/FacebookConfigModal.vue';
import {
  getFormStatus,
  getConnectionState,
  oauthStart,
  disconnectFormPage,
  type FacebookFormStatus,
} from '@/api/facebook-api';

const route = useRoute();
const router = useRouter();
const toast = useToast();

const status = ref<FacebookFormStatus | null>(null);
const loading = ref(false);
const configOpen = ref(false);
const campaignLocked = ref(false);
const disconnecting = reactive<Record<string, boolean>>({});

async function fetchStatus(): Promise<void> {
  loading.value = true;
  try {
    status.value = await getFormStatus();
  } catch {
    toast.error('Không tải được trạng thái Form');
  } finally {
    loading.value = false;
  }
}

async function fetchConnectionState(): Promise<void> {
  try {
    const state = await getConnectionState();
    campaignLocked.value = state.campaignConnected;
  } catch {
    campaignLocked.value = false;
  }
}

async function onConnect(): Promise<void> {
  if (campaignLocked.value) return;
  try {
    const url = await oauthStart('form');
    window.location.href = url;
  } catch {
    toast.error('Không khởi tạo được kết nối Facebook');
  }
}

async function onDisconnect(pageId: string, label: string): Promise<void> {
  if (!confirm(`Ngắt kết nối Page "${label}"? Lead mới từ Page này sẽ KHÔNG vào CRM nữa.`)) return;
  disconnecting[pageId] = true;
  try {
    await disconnectFormPage(pageId);
    toast.success('Đã ngắt kết nối');
    await Promise.all([fetchStatus(), fetchConnectionState()]);
  } catch {
    toast.error('Ngắt kết nối thất bại');
  } finally {
    disconnecting[pageId] = false;
  }
}

function onConfigSaved(): void {
  void fetchStatus();
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Đã copy');
  } catch {
    toast.error('Không copy được');
  }
}

// OAuth callback status from URL query params (?status=success&pages=N | ?status=error&reason=...)
function readOauthStatus(): void {
  const s = route.query.status as string | undefined;
  if (!s) return;
  if (s === 'success') {
    toast.success('Kết nối Facebook thành công, đang đồng bộ form...');
  } else if (s === 'error') {
    toast.error(`Kết nối thất bại: ${decodeURIComponent(String(route.query.reason ?? ''))}`);
  }
  void router.replace({ path: route.path, query: {} });
}

onMounted(() => {
  readOauthStatus();
  void fetchStatus();
  void fetchConnectionState();
});
</script>

<style scoped>
.fb-page {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
  font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
  color: #1f2937;
}
.fb-head {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e5e7eb;
}
.fb-head-left { display: flex; gap: 12px; align-items: center; flex: 1; }
.fb-head-actions { display: flex; gap: 8px; align-items: center; }
.fb-icon {
  width: 48px; height: 48px; background: #1877F2; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 24px;
}
.fb-title { font-size: 22px; margin: 0; font-weight: 700; }
.fb-sub { font-size: 13px; color: #6b7280; margin: 2px 0 0; }

.fb-lock-hint {
  background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
  border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px;
}

.fb-btn-primary {
  background: #1877F2; color: white; border: none; border-radius: 8px;
  padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.fb-btn-primary:hover:not(:disabled) { background: #166fe5; }
.fb-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.fb-btn-ghost {
  background: white; color: #374151; border: 1px solid #d1d5db; border-radius: 7px;
  padding: 8px 14px; font-size: 13px; cursor: pointer;
}
.fb-btn-ghost:hover { background: #f3f4f6; }
.fb-btn-danger {
  background: white; color: #dc2626; border: 1px solid #fca5a5; border-radius: 7px;
  padding: 6px 12px; font-size: 12px; cursor: pointer;
}
.fb-btn-danger:hover:not(:disabled) { background: #fef2f2; }
.fb-btn-danger:disabled { opacity: 0.5; cursor: wait; }

.fb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
.fb-stat-card {
  background: white; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 14px 16px;
}
.fb-stat-card.ok { border-color: #86efac; background: #f0fdf4; }
.fb-stat-card.warn { border-color: #fde68a; background: #fffbeb; }
.fb-stat-card.err { border-color: #fca5a5; background: #fef2f2; }
.fb-stat-label { font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: 600; letter-spacing: 0.4px; }
.fb-stat-val { font-size: 26px; font-weight: 700; margin-top: 4px; color: #0f172a; }

.fb-card {
  background: white; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 16px 18px; margin-bottom: 16px;
}
.fb-card-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; color: #0f172a; }
.fb-row { display: flex; align-items: center; gap: 10px; }
.fb-mono { font-family: monospace; background: #f1f5f9; padding: 6px 10px; border-radius: 5px; font-size: 12px; flex: 1; color: #0f172a; word-break: break-all; }
.fb-mono.mini { padding: 2px 6px; font-size: 11.5px; flex: none; }
.fb-empty { color: #9ca3af; font-size: 13px; padding: 12px 0; font-style: italic; }
.fb-empty.mini { padding: 0; }

.fb-pages-list { display: flex; flex-direction: column; gap: 10px; }
.fb-page-row {
  border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px;
  display: flex; align-items: center; gap: 8px;
}
.fb-page-info { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.fb-page-name { font-weight: 700; font-size: 14px; }
.fb-page-meta { font-size: 11.5px; color: #6b7280; }
.fb-page-meta code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-family: monospace; color: #0f172a; }
.fb-page-actions { display: flex; gap: 8px; align-items: center; }
.fb-pill { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; }
.fb-pill.ok { background: #dcfce7; color: #166534; }
.fb-pill.off { background: #f3f4f6; color: #6b7280; }
.fb-pill.warn { background: #fef3c7; color: #92400e; }

.fb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.fb-table th, .fb-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f3f4f6; }
.fb-table th { background: #fafafa; font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: 600; }
.list-emoji { font-size: 16px; margin-right: 6px; }
.list-name { font-weight: 600; color: #0f172a; }

.fb-help { margin-top: 24px; }
.fb-help details {
  background: white; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 10px 14px; margin-bottom: 8px;
}
.fb-help summary { cursor: pointer; font-weight: 600; font-size: 13px; color: #0f172a; }
.fb-help ol, .fb-help ul { margin: 10px 0 4px 20px; font-size: 13px; color: #374151; }
.fb-help li { margin-bottom: 5px; line-height: 1.5; }
.fb-help code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-family: monospace; color: #0f172a; font-size: 12px; word-break: break-all; }
.fb-help a { color: #1877F2; text-decoration: none; }
.fb-help a:hover { text-decoration: underline; }
</style>
