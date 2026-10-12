import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
import { getUserProfileUrl } from '../utils/api';


export interface UserProfile {
  id: string;
  username: string;
  avatar_url?: string | null;
  is_guest: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signInWithGoogleIdToken: (idToken: string) => Promise<{ error?: string }>;
  signInAsGuest: (nickname: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  updateNickname: (newNickname: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_GUEST_KEY = 'poe_na_tela_guest_profile';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Carregar perfil local de convidado se existir
  const loadLocalGuest = (): UserProfile | null => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_GUEST_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      const guest = loadLocalGuest();
      if (guest) {
        setProfile(guest);
      }
      setIsLoading(false);
      return;
    }

    // Obter sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        const guest = loadLocalGuest();
        if (guest) setProfile(guest);
        setIsLoading(false);
      }
    });

    // Ouvir mudanças de autenticação
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user);
      } else {
        const guest = loadLocalGuest();
        setProfile(guest);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (currentUser: User) => {
    try {
      const isAnon = currentUser.is_anonymous || currentUser.app_metadata?.provider === 'anonymous';
      let profileData: UserProfile | null = null;

      if (isSupabaseConfigured && supabase) {
        try {
          const sessionRes = await supabase.auth.getSession();
          const token = sessionRes.data.session?.access_token;
          if (token) {
            const res = await fetch(getUserProfileUrl(), {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const json = await res.json();
              if (json.profile) {
                profileData = json.profile;
              }
            }
          }
        } catch (apiErr) {
          console.warn('Erro ao buscar perfil via backend:', apiErr);
        }
      }

      if (profileData) {
        setProfile(profileData);
      } else {
        // Fallback construído a partir dos metadados do auth
        const name =
          currentUser.user_metadata?.name ||
          currentUser.user_metadata?.user_name ||
          currentUser.user_metadata?.nickname ||
          currentUser.email?.split('@')[0] ||
          (isAnon ? 'Convidado' : 'Usuário');

        const avatar =
          currentUser.user_metadata?.avatar_url ||
          currentUser.user_metadata?.picture ||
          null;

        const fallbackProfile: UserProfile = {
          id: currentUser.id,
          username: name,
          avatar_url: avatar,
          is_guest: isAnon,
        };
        setProfile(fallbackProfile);
      }
    } catch (err) {
      console.warn('Erro ao buscar perfil:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogleIdToken = async (idToken: string) => {
    if (!isSupabaseConfigured || !supabase) {
      const msg = 'Configuração do Supabase ausente. Verifique o arquivo client/.env e recarregue a página.';
      console.error('[Auth]', msg);
      alert(msg);
      return { error: msg };
    }

    try {
      setIsLoading(true);
      console.log('[Auth] Autenticando com Google ID Token nativo via Supabase...');
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        console.error('[Auth] Erro retornado pelo signInWithIdToken:', error);
        alert(`Erro ao autenticar com Google: ${error.message}`);
        return { error: error.message };
      }

      if (data?.user) {
        await fetchProfile(data.user);
      }
      return {};
    } catch (err: any) {
      const msg = err?.message || 'Falha ao autenticar com ID Token do Google.';
      console.error('[Auth] Exceção em signInWithGoogleIdToken:', err);
      alert(`Falha no login com Google: ${msg}`);
      return { error: msg };
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!isSupabaseConfigured || !supabase) {
      const msg = 'Configuração do Supabase ausente. Verifique o arquivo client/.env e recarregue a página.';
      console.error('[Auth]', msg);
      alert(msg);
      return { error: msg };
    }

    try {
      console.log('[Auth] Redirecionando para login com Google...');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (error) {
        console.error('[Auth] Erro retornado pelo Google OAuth:', error);
        alert(`Erro ao iniciar autenticação: ${error.message}`);
        return { error: error.message };
      }

      if (data?.url) {
        window.location.href = data.url;
      }

      return {};
    } catch (err: any) {
      const msg = err?.message || 'Erro ao iniciar login com Google.';
      console.error('[Auth] Exceção em signInWithGoogle:', err);
      alert(`Falha no login com Google: ${msg}`);
      return { error: msg };
    }
  };

  const signInAsGuest = async (nickname: string) => {
    const cleanNick = nickname.trim().slice(0, 32);
    if (!cleanNick) return { error: 'Por favor, insira um apelido válido.' };

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.signInAnonymously({
          options: {
            data: {
              name: cleanNick,
              nickname: cleanNick,
            },
          },
        });
        if (error) {
          console.warn('Fallback para convidado local após erro no anon sign-in:', error.message);
        } else if (data.user) {
          const guestProfile: UserProfile = {
            id: data.user.id,
            username: cleanNick,
            is_guest: true,
          };
          setProfile(guestProfile);
          localStorage.setItem(LOCAL_STORAGE_GUEST_KEY, JSON.stringify(guestProfile));
          return {};
        }
      } catch (err: any) {
        console.warn('Erro no sign-in anônimo Supabase:', err);
      }
    }

    // Convidado em modo local
    const localProfile: UserProfile = {
      id: 'guest_' + Math.random().toString(36).substring(2, 10),
      username: cleanNick,
      is_guest: true,
    };
    setProfile(localProfile);
    localStorage.setItem(LOCAL_STORAGE_GUEST_KEY, JSON.stringify(localProfile));
    return {};
  };

  const signOut = async () => {
    if (supabase && session) {
      try {
        await supabase.auth.signOut();
      } catch {}
    }
    localStorage.removeItem(LOCAL_STORAGE_GUEST_KEY);
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  const updateNickname = (newNickname: string) => {
    const cleanNick = newNickname.trim().slice(0, 32);
    if (!cleanNick) return;

    if (profile) {
      const updated = { ...profile, username: cleanNick };
      setProfile(updated);
      if (profile.is_guest) {
        localStorage.setItem(LOCAL_STORAGE_GUEST_KEY, JSON.stringify(updated));
      }
    }
  };

  const isAuthenticated = useMemo(() => {
    return Boolean(user && !user.is_anonymous && !profile?.is_guest);
  }, [user, profile]);

  const isGuest = useMemo(() => {
    return Boolean(profile?.is_guest || !isAuthenticated);
  }, [profile, isAuthenticated]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        isAuthenticated,
        isGuest,
        isLoading,
        isConfigured: isSupabaseConfigured,
        signInWithGoogle,
        signInWithGoogleIdToken,
        signInAsGuest,
        signOut,
        updateNickname,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
