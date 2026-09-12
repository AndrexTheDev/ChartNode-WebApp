// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';

/**
 * Tiny session toast bus (memory-only). Used by price alerts and anything
 * else that needs a transient neon notification. `push` auto-dismisses
 * after `ttlMs` (default 6 s); max 4 stacked toasts.
 */

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'bull' | 'bear' | 'warn';
}

interface ToastState {
  toasts: Toast[];
  push: (text: string, tone?: Toast['tone'], ttlMs?: number) => void;
  dismiss: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (text, tone = 'info', ttlMs = 6000) => {
    toastCounter += 1;
    const id = `toast-${Date.now().toString(36)}-${toastCounter}`;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, text, tone }] }));
    if (typeof window !== 'undefined') {
      setTimeout(() => get().dismiss(id), ttlMs);
    }
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
