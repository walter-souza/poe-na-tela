import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogIn } from 'lucide-react';

interface GoogleLoginButtonProps {
  theme?: 'outline' | 'filled_black' | 'filled_blue';
  size?: 'large' | 'medium' | 'small';
  shape?: 'pill' | 'rectangular';
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  width?: number;
  className?: string;
  onSuccess?: () => void;
}

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '563489534853-npigrhgtcpmb7le5g7c2lleld19ha9r0.apps.googleusercontent.com';

declare global {
  interface Window {
    google?: any;
  }
}

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({
  theme = 'outline',
  size = 'medium',
  shape = 'pill',
  text = 'signin_with',
  width,
  className = '',
  onSuccess,
}) => {
  const { signInWithGoogleIdToken, signInWithGoogle, isAuthenticated } = useAuth();
  const btnContainerRef = useRef<HTMLDivElement>(null);
  const [isGsiLoaded, setIsGsiLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) return;

    let isMounted = true;
    const checkGsi = () => {
      if (typeof window !== 'undefined' && window.google?.accounts?.id) {
        if (isMounted) setIsGsiLoaded(true);
        return true;
      }
      return false;
    };

    if (checkGsi()) return;

    const interval = setInterval(() => {
      if (checkGsi()) {
        clearInterval(interval);
      }
    }, 200);

    const timeout = setTimeout(() => clearInterval(interval), 4000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isGsiLoaded || !btnContainerRef.current || isAuthenticated) return;

    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: any) => {
          if (response?.credential) {
            setIsLoading(true);
            try {
              const res = await signInWithGoogleIdToken(response.credential);
              if (!res.error && onSuccess) {
                onSuccess();
              }
            } finally {
              setIsLoading(false);
            }
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      btnContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(btnContainerRef.current, {
        theme,
        size,
        shape,
        text,
        logo_alignment: 'left',
        ...(width ? { width } : {}),
      });
    } catch (err) {
      console.warn('[GoogleLoginButton] Falha ao inicializar GIS:', err);
    }
  }, [isGsiLoaded, theme, size, shape, text, width, isAuthenticated, signInWithGoogleIdToken, onSuccess]);

  if (isAuthenticated) return null;

  return (
    <div className={`inline-flex items-center justify-center relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xs rounded-full flex items-center justify-center z-10">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div ref={btnContainerRef} className="overflow-hidden min-h-[32px] flex items-center justify-center" />
      {!isGsiLoaded && (
        <button
          type="button"
          onClick={() => signInWithGoogle()}
          className="flex items-center gap-1.5 bg-white hover:bg-gray-100 text-gray-900 font-semibold px-2.5 py-1 rounded-full text-xs shadow-sm transition cursor-pointer"
        >
          <LogIn className="w-3 h-3 text-indigo-600" />
          <span>Entrar com Google</span>
        </button>
      )}
    </div>
  );
};
