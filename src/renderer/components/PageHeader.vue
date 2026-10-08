<script setup lang="ts">
defineProps<{ title: string; note?: string }>()
</script>

<template>
  <div class="pg-head">
    <div>
      <h3>{{ title }}</h3>
      <p v-if="note" class="note">{{ note }}</p>
    </div>
    <div class="right">
      <slot name="right"></slot>
    </div>
  </div>
</template>

<style scoped>
.pg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 14px;
}
h3 {
  font-size: 19px;
  font-weight: 700;
}
.note {
  font-size: 12px;
  color: var(--txt3);
  margin-top: 2px;
}
</style>
