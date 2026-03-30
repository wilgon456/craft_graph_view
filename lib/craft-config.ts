export const DEFAULT_CRAFT_API_URL = "https://connect.craft.do/links/F7c9TqdSc2g/api/v1"

export const STORAGE_KEY_URL = "craft_api_url"
export const STORAGE_KEY_KEY = "craft_api_key"

export function getCraftApiUrl(): string {
  if (typeof window === "undefined") {
    return DEFAULT_CRAFT_API_URL
  }

  const storedUrl = localStorage.getItem(STORAGE_KEY_URL)?.trim()
  return storedUrl || DEFAULT_CRAFT_API_URL
}

export function getCraftApiKey(): string {
  if (typeof window === "undefined") {
    return ""
  }

  return localStorage.getItem(STORAGE_KEY_KEY)?.trim() || ""
}

export function getCraftConnection() {
  return {
    apiUrl: getCraftApiUrl(),
    apiKey: getCraftApiKey(),
  }
}

export function persistCraftApiUrl(apiUrl: string = DEFAULT_CRAFT_API_URL) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY_URL, apiUrl)
}

export function clearStoredCraftConnection() {
  if (typeof window === "undefined") return
  localStorage.removeItem(STORAGE_KEY_URL)
  localStorage.removeItem(STORAGE_KEY_KEY)
}
