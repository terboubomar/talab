import type { CartLine } from "./menu";

const CART_STORAGE_KEY = "talab.cart";

export function saveCart(lines: CartLine[]) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    /* storage unavailable */
  }
}

export function readCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function clearCart() {
  try {
    localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
