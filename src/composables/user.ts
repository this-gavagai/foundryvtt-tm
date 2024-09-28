import { ref } from 'vue'

const userId = ref('')

function getUserId() {
  return userId?.value
}
function setUserId(newValue: string) {
  userId.value = newValue
}

export function useUserId() {
  return { getUserId, setUserId, userId }
}
