/**
 * Composable for Zalo account management logic:
 * - CRUD operations via REST API
 * - Real-time QR login flow via Socket.IO
 */
import { ref, onUnmounted } from 'vue';
import { api } from '@/api/index';
import { Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';

export interface ZaloAccount {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  zaloUid: string | null;
  status: string;
  liveStatus?: string;
  phone: string | null;
  sessionData: any;
  ownerUserId: string;
  // Owner (chủ nick) — backend /zalo-accounts trả kèm. Dùng cho nhóm/lọc theo người dùng.
  owner?: { id: string; fullName: string | null; email: string } | null;
  createdAt: string;
  proxyUrl?: string | null; // masked by backend
  hasProxy?: boolean;
}

// onStatusChange: callback gọi khi nick đổi trạng thái qua socket (connected/disconnected/
// error/reconnect-failed). Dashboard truyền refreshAll để grid card (list enriched) tự cập
// nhật REACTIVE — trước đây chỉ fetchAccounts (list basic) nên grid phải F5 mới thấy đổi.
export function useZaloAccounts(opts?: { onStatusChange?: () => void }) {
  const accounts = ref<ZaloAccount[]>([]);
  const loading = ref(false);
  const adding = ref(false);
  const deleting = ref(false);

  // QR dialog state
  const showQRDialog = ref(false);
  const qrImage = ref('');
  const qrScanned = ref(false);
  const scannedName = ref('');
  const qrError = ref('');
  const currentLoginAccountId = ref('');
  // fix ②: nick quét trúng zaloUid đã tồn tại → BE emit 'zalo:duplicate' + dọn record rác.
  const duplicateInfo = ref<{ owner: string | null; message: string } | null>(null);

  let socket: Socket | null = null;

  function statusColor(status: string) {
    switch (status) {
      case 'connected': return 'success';
      case 'qr_pending': case 'connecting': return 'warning';
      default: return 'error';
    }
  }

  function statusText(status: string) {
    switch (status) {
      case 'connected': return 'Đã kết nối';
      case 'qr_pending': return 'Chờ QR';
      case 'connecting': return 'Đang kết nối...';
      default: return 'Ngắt kết nối';
    }
  }

  async function fetchAccounts() {
    loading.value = true;
    try {
      const res = await api.get('/zalo-accounts');
      accounts.value = res.data;
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      loading.value = false;
    }
  }

  // Trả về { ok, reused?, account?, error?, code?, message? } — fix ① cần phân biệt:
  //   • 409 account_owned_by_other → báo nick thuộc người khác (chặn)
  //   • 200 reused (nick của chính mình) → dùng lại record cũ, không tạo mới
  async function addAccount(displayName: string, proxyUrl?: string, phone?: string) {
    adding.value = true;
    try {
      const { data } = await api.post('/zalo-accounts', {
        displayName: displayName || undefined,
        proxyUrl: proxyUrl?.trim() || undefined,
        phone: phone || undefined,
      });
      await fetchAccounts();
      return { ok: true, reused: !!data?.reused, account: data };
    } catch (err: any) {
      const code = err?.response?.data?.code || err?.response?.data?.error;
      const message = err?.response?.data?.message || 'Không tạo được nick.';
      console.error('Failed to add account:', code || err);
      return { ok: false, code, message };
    } finally {
      adding.value = false;
    }
  }

  async function updateProxy(accountId: string, proxyUrl: string | null) {
    try {
      await api.put(`/zalo-accounts/${accountId}/proxy`, { proxyUrl: proxyUrl?.trim() || null });
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Update proxy failed:', err);
      return false;
    }
  }

  async function loginAccount(accountId: string) {
    currentLoginAccountId.value = accountId;
    qrImage.value = '';
    qrScanned.value = false;
    scannedName.value = '';
    qrError.value = '';
    showQRDialog.value = true;
    socket?.emit('zalo:subscribe', { accountId });
    try {
      await api.post(`/zalo-accounts/${accountId}/login`, {});
    } catch (err: any) {
      qrError.value = err.response?.data?.error || 'Không thể bắt đầu đăng nhập';
    }
  }

  async function reconnectAccount(accountId: string): Promise<{ success: boolean; message: string; needsQR?: boolean }> {
    try {
      await api.post(`/zalo-accounts/${accountId}/reconnect`, {});
      await fetchAccounts();
      return { success: true, message: 'Đang kết nối lại nick…' };
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Kết nối lại thất bại';
      // Nick chưa có phiên lưu (chưa từng login qua QR) → cần quét QR thay vì reconnect ngầm.
      if (err.response?.status === 400 && /no saved session/i.test(msg)) {
        return { success: false, message: msg, needsQR: true };
      }
      console.error('Reconnect failed:', err);
      return { success: false, message: msg };
    }
  }

  // purge=true → "Xoá khỏi CRM": BE wipe sessionData + nhả zaloUid (re-connect tạo nick mới).
  async function deleteAccount(account: ZaloAccount, purge = false) {
    deleting.value = true;
    try {
      await api.delete(`/zalo-accounts/${account.id}`, { params: { purge: purge ? 'true' : undefined } });
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Delete failed:', err);
      return false;
    } finally {
      deleting.value = false;
    }
  }

  function cancelQR() {
    showQRDialog.value = false;
    socket?.emit('zalo:unsubscribe', { accountId: currentLoginAccountId.value });
  }

  function setupSocket() {
    socket = createAppSocket();

    socket.on('zalo:qr', (data: { accountId: string; qrImage: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrImage.value = data.qrImage;
    });

    socket.on('zalo:scanned', (data: { accountId: string; displayName: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = true;
        scannedName.value = data.displayName;
      }
    });

    socket.on('zalo:connected', (_data: { accountId: string }) => {
      showQRDialog.value = false;
      fetchAccounts();
      opts?.onStatusChange?.(); // refresh grid enriched → card tự đổi sang "đang kết nối"
    });

    socket.on('zalo:disconnected', (_data: { accountId: string }) => { fetchAccounts(); opts?.onStatusChange?.(); });

    socket.on('zalo:error', (data: { accountId: string; error: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrError.value = data.error;
      fetchAccounts();
      opts?.onStatusChange?.();
    });

    socket.on('zalo:qr-expired', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrError.value = 'QR đã hết hạn, đang tạo lại...';
      }
    });

    socket.on('zalo:reconnect-failed', (_data: { accountId: string }) => { fetchAccounts(); opts?.onStatusChange?.(); });

    // fix ②: nick quét trúng zaloUid đã tồn tại (record rác đã bị BE xoá) → báo tử tế,
    // đóng QR. Khác zalo:error ở chỗ đây là tình huống nghiệp vụ (nick trùng), không phải lỗi kỹ thuật.
    socket.on('zalo:duplicate', (data: { accountId: string; owner: string | null; message: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = false;
        duplicateInfo.value = { owner: data.owner ?? null, message: data.message };
        showQRDialog.value = false;
      }
      fetchAccounts();
    });
  }

  onUnmounted(() => { socket?.disconnect(); });

  return {
    accounts, loading, adding, deleting,
    showQRDialog, qrImage, qrScanned, scannedName, qrError, duplicateInfo,
    statusColor, statusText,
    fetchAccounts, addAccount, loginAccount, reconnectAccount, deleteAccount,
    updateProxy, cancelQR, setupSocket,
  };
}
