<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { availableLocales, setLocale } from '@/plugins/i18n'
import { useTheme, THEMES } from '@/composables/useTheme'
import ModalBox from './ModalBox.vue'
import Dropdown from '@/components/widgets/DropdownWidget.vue'

const { locale, t } = useI18n()
const { activeTheme, setTheme } = useTheme()

const themeList = [
  { id: '', name: t('common.none') },
  ...THEMES.map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }))
]

const modalRef = ref<InstanceType<typeof ModalBox>>()
function open() {
  modalRef.value?.open()
}
function close() {
  modalRef.value?.close()
}

defineExpose({ open, close })
</script>
<template>
  <ModalBox ref="modalRef" :title="$t('settings.title')">
    <div class="mt-4 flex flex-col gap-4">
      <div>
        <div class="text-lg italic">{{ $t('sideMenu.language') }}</div>
        <Dropdown
          :list="availableLocales"
          :selectedId="locale"
          :changed="(newId: string) => setLocale(newId)"
        />
      </div>
      <div>
        <div class="text-lg italic">{{ $t('sideMenu.theme') }}</div>
        <Dropdown
          :list="themeList"
          :selectedId="activeTheme ?? ''"
          :changed="(newId: string) => setTheme(newId || null)"
        />
      </div>
    </div>
  </ModalBox>
</template>
