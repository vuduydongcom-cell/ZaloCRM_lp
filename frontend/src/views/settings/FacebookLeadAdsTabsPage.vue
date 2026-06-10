<!--
  Facebook Lead Ads — wrapper 2 tab (2026-06-09).
  Gộp 2 luồng ingest lead Facebook trên cùng 1 màn hình:
    • Tab "Lead Ads Campaign" — bản hiện tại: route theo #KEY trong tên Campaign.
    • Tab "Lead Ads Form"     — port từ main: OAuth Page + webhook leadgen + map form→list.
  Mỗi tab là 1 page độc lập (tự load qua composable/api riêng) — chỉ bọc tab bar.
-->
<template>
  <div class="fb-tabs-wrap">
    <nav class="fb-tabs">
      <button
        class="fb-tab"
        :class="{ active: tab === 'campaign' }"
        @click="tab = 'campaign'"
      >
        🎯 Lead Ads Campaign
      </button>
      <button
        class="fb-tab"
        :class="{ active: tab === 'form' }"
        @click="tab = 'form'"
      >
        📋 Lead Ads Form
      </button>
    </nav>

    <!-- Giữ cả 2 mounted bằng v-show để không mất state khi chuyển tab. -->
    <div v-show="tab === 'campaign'">
      <FacebookLeadAdsPage />
    </div>
    <div v-show="tab === 'form'">
      <FacebookChannelView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import FacebookLeadAdsPage from './FacebookLeadAdsPage.vue';
import FacebookChannelView from './channels/FacebookChannelView.vue';

// Tab mặc định = Campaign (luồng đang dùng). ?tab=form để deep-link sang Form.
const initial = new URLSearchParams(window.location.search).get('tab');
const tab = ref<'campaign' | 'form'>(initial === 'form' ? 'form' : 'campaign');
</script>

<style scoped>
.fb-tabs-wrap {
  display: flex;
  flex-direction: column;
}
.fb-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border, #e5e7eb);
  margin-bottom: 16px;
  padding: 0 4px;
}
.fb-tab {
  appearance: none;
  border: none;
  background: transparent;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted, #6b7280);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.fb-tab:hover {
  color: var(--text, #111827);
}
.fb-tab.active {
  color: #1877f2; /* Facebook blue */
  border-bottom-color: #1877f2;
}
</style>
