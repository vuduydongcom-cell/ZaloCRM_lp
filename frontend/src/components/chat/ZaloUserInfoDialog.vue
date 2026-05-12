<template>
  <v-dialog v-model="open" max-width="440">
    <v-card v-if="info" class="zui-card">
      <!-- Cover + avatar overlay -->
      <div class="zui-cover" :style="info.coverPhoto ? `background-image:url(${info.coverPhoto})` : ''">
        <div class="zui-avatar-wrap">
          <img v-if="info.avatarBig || info.avatar" :src="info.avatarBig || info.avatar" alt="avatar" class="zui-avatar" />
          <div v-else class="zui-avatar zui-avatar-fallback">{{ initials }}</div>
          <span v-if="info.isActive === 1" class="zui-online-dot" title="Đang hoạt động"></span>
        </div>
        <v-btn icon size="small" variant="text" class="zui-close" @click="open = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <v-card-text class="zui-body">
        <!-- Tên + gender icon + verified biz badge -->
        <div class="zui-name">
          {{ info.displayName || info.zaloName || 'Người dùng Zalo' }}
          <v-icon v-if="info.gender === 0" size="16" color="primary" class="ml-1">mdi-gender-male</v-icon>
          <v-icon v-else-if="info.gender === 1" size="16" color="pink" class="ml-1">mdi-gender-female</v-icon>
          <v-tooltip v-if="info.bizPkg && info.bizPkg.pkgId > 0" text="Tài khoản doanh nghiệp">
            <template #activator="{ props: tipProps }">
              <v-icon v-bind="tipProps" size="14" color="warning" class="ml-1">mdi-check-decagram</v-icon>
            </template>
          </v-tooltip>
        </div>

        <!-- Username + UID (monospace) -->
        <div class="zui-handle">
          <span v-if="info.username">@{{ info.username }}</span>
          <span class="zui-uid">UID: {{ info.uid }}</span>
        </div>

        <!-- Status quote text user tự đặt -->
        <div v-if="info.status && !isPhoneStatus" class="zui-status">"{{ info.status }}"</div>

        <v-divider class="my-3" />

        <!-- Section: Thông tin liên hệ -->
        <div class="zui-section">
          <div v-if="info.phoneNumber || isPhoneStatus" class="zui-row">
            <v-icon size="14" color="success">mdi-phone</v-icon>
            <span>{{ info.phoneNumber || info.status }}</span>
            <v-btn
              icon size="x-small" variant="text" class="ml-auto"
              :title="'Sao chép SĐT'"
              @click="copy(info.phoneNumber || info.status)"
            >
              <v-icon size="14">mdi-content-copy</v-icon>
            </v-btn>
          </div>
          <div v-if="info.sdob || info.dob" class="zui-row">
            <v-icon size="14">mdi-cake-variant</v-icon>
            <span>Sinh nhật: <strong>{{ formatDob(info.sdob || info.dob) }}</strong></span>
          </div>
        </div>

        <!-- Section: Trạng thái mối quan hệ -->
        <div class="zui-section">
          <div class="zui-row">
            <v-icon size="14" :color="info.isFr === 1 ? 'success' : 'grey'">
              {{ info.isFr === 1 ? 'mdi-account-check' : 'mdi-account-question' }}
            </v-icon>
            <span>{{ info.isFr === 1 ? 'Đã kết bạn' : 'Chưa kết bạn' }}</span>
          </div>
          <div v-if="info.isBlocked === 1" class="zui-row" style="color:#d32f2f">
            <v-icon size="14" color="error">mdi-block-helper</v-icon>
            <span>Đã chặn</span>
          </div>
          <div v-if="info.lastActionTime > 0" class="zui-row">
            <v-icon size="14">mdi-clock-outline</v-icon>
            <span>Hoạt động gần đây: <strong>{{ formatRelativeTime(info.lastActionTime) }}</strong></span>
          </div>
        </div>

        <!-- Section: Active devices -->
        <div v-if="info.isActivePC === 1 || info.isActiveWeb === 1" class="zui-devices">
          <span class="zui-devices-label">Thiết bị:</span>
          <v-chip v-if="info.isActivePC === 1" size="x-small" variant="tonal" color="primary" prepend-icon="mdi-monitor">PC</v-chip>
          <v-chip v-if="info.isActiveWeb === 1" size="x-small" variant="tonal" color="info" prepend-icon="mdi-web">Web</v-chip>
        </div>

        <!-- Section: OA / Biz info -->
        <div v-if="info.bizPkg && info.bizPkg.pkgId > 0" class="zui-section">
          <div class="zui-row">
            <v-icon size="14" color="warning">mdi-briefcase-check</v-icon>
            <span>Tài khoản DN <strong v-if="info.bizPkg.label">({{ info.bizPkg.label }})</strong></span>
          </div>
          <div v-if="info.bizPkg.createdTs > 0" class="zui-row">
            <v-icon size="14">mdi-calendar-plus</v-icon>
            <span>Tạo: {{ formatDate(info.bizPkg.createdTs * 1000) }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="zui-actions">
          <v-btn
            size="small" variant="tonal" color="primary"
            prepend-icon="mdi-link-variant"
            :href="`https://zalo.me/${info.uid}`"
            target="_blank"
          >Mở trên Zalo</v-btn>
          <v-btn
            size="small" variant="text" color="grey"
            prepend-icon="mdi-content-copy"
            @click="copy(info.uid)"
          >Copy UID</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card v-else-if="loading" class="zui-loading">
      <v-progress-circular indeterminate size="24" />
      <span class="ml-3">Đang tải thông tin...</span>
    </v-card>

    <v-card v-else-if="error" class="zui-error pa-4">
      <v-icon color="error">mdi-alert</v-icon>
      <span class="ml-2">Không tải được thông tin user</span>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api } from '@/api/index';

interface ZaloUserInfo {
  uid: string;
  userId: string;
  username: string;
  globalId: string;
  zaloName: string;
  displayName: string;
  avatar: string;
  avatarBig: string;
  bgavatar: string;
  coverPhoto: string;
  gender: number;
  dob: number | string | null;
  sdob: string | null;
  phoneNumber: string;
  status: string;
  isFr: number;
  isBlocked: number;
  isActive: number;
  isActivePC: number;
  isActiveWeb: number;
  isValid: number;
  lastActionTime: number;
  lastUpdateTime: number;
  type: number;
  accountStatus: number;
  userMode: number;
  bizPkg: { label: string | null; pkgId: number; createdTs: number } | null;
  isExtensionAccount: number;
  oaInfo: unknown;
  oaStatus: unknown;
}

const props = defineProps<{
  modelValue: boolean;
  uid: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const info = ref<ZaloUserInfo | null>(null);
const loading = ref(false);
const error = ref(false);

async function load(uid: string) {
  loading.value = true;
  error.value = false;
  info.value = null;
  try {
    const res = await api.get(`/zalo-user-info/${uid}`);
    info.value = res.data as ZaloUserInfo;
  } catch (err) {
    console.error('[zalo-user-info] load error:', err);
    error.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => props.uid, (uid) => { if (uid && props.modelValue) void load(uid); });
watch(() => props.modelValue, (v) => { if (v && props.uid) void load(props.uid); });

const initials = computed(() => {
  const name = info.value?.zaloName || info.value?.displayName || 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

// Zalo đôi khi lưu phone trong `status` field thay vì `phoneNumber`
// (vd "0904808000" khi user chỉ điền số mà không có bio text) — detect pattern
const isPhoneStatus = computed(() => {
  const s = info.value?.status || '';
  return /^0\d{9,10}$/.test(s.trim());
});

function formatDob(d: string | number | null): string {
  if (!d) return '';
  const s = String(d);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const ts = Number(d);
  if (ts > 1e9) return new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleDateString('vi-VN');
  return s;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('vi-VN');
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

function copy(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}
</script>

<style scoped>
.zui-card { border-radius: 14px; overflow: hidden; }
.zui-cover {
  position: relative;
  height: 140px;
  background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%);
  background-size: cover;
  background-position: center;
}
.zui-close {
  position: absolute; top: 8px; right: 8px;
  background: rgba(255,255,255,0.85) !important;
}
.zui-avatar-wrap {
  position: absolute; bottom: -40px; left: 50%; transform: translateX(-50%);
}
.zui-avatar {
  width: 80px; height: 80px; border-radius: 50%;
  border: 3px solid white;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  object-fit: cover;
}
.zui-avatar-fallback {
  background: linear-gradient(135deg, #90caf9, #1976d2);
  color: white; font-weight: 700; font-size: 24px;
  display: flex; align-items: center; justify-content: center;
}
.zui-online-dot {
  position: absolute; bottom: 4px; right: 4px;
  width: 14px; height: 14px;
  background: #4caf50;
  border: 2px solid white;
  border-radius: 50%;
}
.zui-body { padding-top: 52px !important; text-align: center; }
.zui-name {
  font-size: 18px; font-weight: 600;
  display: inline-flex; align-items: center;
}
.zui-handle {
  font-size: 11px; color: #757575; font-family: monospace;
  margin-top: 4px;
  display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;
}
.zui-uid { color: #9e9e9e; }
.zui-status {
  font-style: italic; color: #424242;
  font-size: 12px; margin-top: 10px;
  padding: 8px 12px; background: #f5f5f5; border-radius: 8px;
  line-height: 1.5;
}
.zui-section {
  text-align: left;
  margin-top: 10px;
}
.zui-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; padding: 4px 0;
  color: #424242;
}
.zui-devices {
  display: flex; align-items: center; gap: 6px;
  margin-top: 10px; font-size: 12px;
  justify-content: center;
}
.zui-devices-label { color: #757575; }
.zui-actions {
  display: flex; gap: 8px; justify-content: center;
  margin-top: 16px; flex-wrap: wrap;
}
.zui-loading, .zui-error {
  display: flex; align-items: center; justify-content: center;
  padding: 30px; font-size: 13px; color: #757575;
}
</style>
