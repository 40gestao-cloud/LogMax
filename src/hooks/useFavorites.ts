import { useCallback, useEffect, useState } from 'react';

// Chave por usuário — evita compartilhar favoritos entre logins na mesma máquina.
const storageKey = (userId: string | null | undefined) =>
  userId ? `logmax:favorites:${userId}` : 'logmax:favorites:anon';

type Favorite = { viewId: string; label: string };

/**
 * Favoritos de submódulos por usuário, persistidos em localStorage.
 *
 * Retorna:
 *   - favorites: lista atual em ordem de inserção (mais antigo primeiro).
 *   - isFavorite(viewId): true se está favoritado.
 *   - toggle(fav): alterna. Aceita o objeto {viewId,label} porque a lista
 *     precisa exibir o label sem re-derivar do menu (que muda por role).
 *
 * Máximo de 8 itens: além disso a "sidebar de acesso rápido" vira sidebar
 * comum. Se atingir o teto, o mais antigo cai fora ao adicionar novo.
 */
const MAX_FAVORITES = 8;

export function useFavorites(userId: string | null | undefined) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  // Carrega do storage quando muda o usuário (login/logout/troca)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(userId));
      setFavorites(raw ? JSON.parse(raw) : []);
    } catch {
      setFavorites([]);
    }
  }, [userId]);

  const persist = useCallback((next: Favorite[]) => {
    try { localStorage.setItem(storageKey(userId), JSON.stringify(next)); } catch {}
    setFavorites(next);
  }, [userId]);

  const isFavorite = useCallback((viewId: string) =>
    favorites.some(f => f.viewId === viewId),
  [favorites]);

  const toggle = useCallback((fav: Favorite) => {
    const exists = favorites.some(f => f.viewId === fav.viewId);
    if (exists) {
      persist(favorites.filter(f => f.viewId !== fav.viewId));
    } else {
      const next = [...favorites, fav].slice(-MAX_FAVORITES);
      persist(next);
    }
  }, [favorites, persist]);

  return { favorites, isFavorite, toggle };
}
