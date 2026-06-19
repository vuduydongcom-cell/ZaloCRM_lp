<!--
  AliasVarPicker.vue — bảng biến BẤM-CHÈN cho mẫu tên gợi nhớ / mẫu tin (2026-06-19, Anh chốt).
  Dùng chung: MucTieuWizard (mẫu tên gợi nhớ) + LeadRequestModal (Lead Pool). Bấm 1 biến → emit('insert','{key}').
  Parent tự chèn token vào ô mẫu (khỏi nhớ tên biến).
-->
<template>
  <div class="avp">
    <button type="button" class="avp-toggle" @click="open = !open">
      {{ open ? 'Ẩn biến ▴' : '＋ Xem biến (bấm để chèn)' }}
    </button>
    <div v-if="open" class="avp-panel">
      <div v-for="g in GROUPS" :key="g.label" class="avp-group">
        <div class="avp-group-label">{{ g.label }}</div>
        <div class="avp-chips">
          <button
            v-for="v in g.vars"
            :key="v.k"
            type="button"
            class="avp-chip"
            :title="v.desc || ('{' + v.k + '}')"
            @click="emit('insert', '{' + v.k + '}')"
          >{{ v.label }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ (e: 'insert', token: string): void }>();
const open = ref(false);

const GROUPS: Array<{ label: string; vars: Array<{ k: string; label: string; desc?: string }> }> = [
  { label: 'Tên & xưng hô', vars: [
    { k: 'zalo_name', label: 'Tên Zalo thật', desc: 'Tên thật trên Zalo của khách' },
    { k: 'gender', label: 'Giới tính', desc: 'Anh / Chị / Anh Chị' },
    { k: 'name', label: 'Tên', desc: 'Tên khách (chữ cuối)' },
    { k: 'name_full', label: 'Họ tên' },
    { k: 'crm_full', label: 'Tên CRM', desc: 'Tên gợi nhớ hiện có / tên import' },
  ] },
  { label: 'Liên hệ', vars: [
    { k: 'phone', label: 'SĐT' },
    { k: 'email', label: 'Email' },
    { k: 'facebook', label: 'Facebook' },
    { k: 'tiktok', label: 'TikTok' },
  ] },
  { label: 'Nhân khẩu / địa chỉ', vars: [
    { k: 'age', label: 'Tuổi' },
    { k: 'occupation', label: 'Nghề' },
    { k: 'province', label: 'Tỉnh' },
    { k: 'district', label: 'Quận/Huyện' },
    { k: 'ward', label: 'Phường/Xã' },
    { k: 'address', label: 'Địa chỉ' },
    { k: 'income', label: 'Tài chính', desc: 'Khoảng thu nhập' },
  ] },
  { label: 'Pipeline / CRM', vars: [
    { k: 'status', label: 'Trạng thái', desc: 'Trạng thái KH' },
    { k: 'nick_status', label: 'TT theo nick' },
    { k: 'source', label: 'Nguồn' },
    { k: 'next_appt', label: 'Hẹn kế' },
    { k: 'score', label: 'Điểm' },
  ] },
  { label: 'Hoạt động', vars: [
    { k: 'first_active', label: 'Lần đầu' },
    { k: 'last_active', label: 'Hoạt động gần' },
    { k: 'last_message', label: 'Tin gần nhất' },
    { k: 'last_inbound', label: 'KH nhắn gần' },
    { k: 'last_outbound', label: 'Mình gửi gần' },
    { k: 'last_interaction', label: 'Tương tác gần' },
    { k: 'msg_count', label: 'Số tin' },
  ] },
  { label: 'Theo nick Zalo', vars: [
    { k: 'uid', label: 'UID' },
    { k: 'nick_name', label: 'Tên nick' },
    { k: 'kb_status', label: 'TT kết bạn' },
    { k: 'became_friend', label: 'Ngày kết bạn' },
  ] },
  { label: 'Sale & ngày & dự án', vars: [
    { k: 'sale', label: 'Sale', desc: 'Tên sale (chữ cuối)' },
    { k: 'sale_full', label: 'Sale đầy đủ' },
    { k: 'date', label: 'Ngày hôm nay', desc: 'dd/mm/yyyy' },
    { k: 'trigger_project', label: 'Viết tắt dự án', desc: 'Chỉ dùng ở Mục tiêu' },
  ] },
];
</script>

<style scoped>
.avp { margin-top: 6px; }
.avp-toggle { background: none; border: none; color: #1786be; font-weight: 600; font-size: 12px; cursor: pointer; padding: 2px 0; font-family: inherit; }
.avp-panel { margin-top: 6px; border: 1px solid var(--line, #e7eaf0); border-radius: 8px; padding: 8px 10px; background: var(--surface-2, #f7f9fc); max-height: 240px; overflow-y: auto; }
.avp-group { margin-bottom: 9px; }
.avp-group:last-child { margin-bottom: 0; }
.avp-group-label { font-size: 10.5px; font-weight: 700; color: var(--ink-3, #6b7488); text-transform: uppercase; letter-spacing: .3px; margin-bottom: 4px; }
.avp-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.avp-chip { background: #fff; border: 1px solid #cfe0ee; color: #1786be; border-radius: 6px; padding: 3px 8px; font-size: 11.5px; cursor: pointer; font-family: inherit; transition: background .12s; }
.avp-chip:hover { background: #eaf4fb; border-color: #1786be; }
</style>
