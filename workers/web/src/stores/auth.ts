import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  username: string | null;
  setUsername: (username: string | null) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    set => ({
      username: null,
      setUsername: username => set({ username }),
      clear: () => set({ username: null }),
    }),
    { name: 'onenav-auth' },
  ),
);
