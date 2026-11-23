import { DevelopedBy } from './DevelopedBy';
import React, { useState } from 'react';
import { Eye, EyeOff, Shield, X } from 'lucide-react';
import { login, getLastUser } from '../utils/auth';
import { AppUser } from '../types';
import logo from '../logo/logo-mark.png';
import { LoginStage } from './LoginStage';
import { BRAND_SLOGAN } from '../brand';

interface LoginScreenProps {
  onUnlock: (user: AppUser) => void;
  onAdminUnlock?: (user: AppUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onUnlock, onAdminUnlock }) => {
  const [username, setUsername] = useState(getLastUser());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (name.length < 2) {
      setError('Enter your username.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError('');

    try {
      const user = await login(name, password);
      if (user.role === 'admin' && onAdminUnlock) {
        onAdminUnlock(user);
      } else {
        onUnlock(user);
      }
    } catch (err) {
      await new Promise((r) => setTimeout(r, 300));
      setError(err instanceof Error ? err.message : 'Could not log in.');
      setShake((n) => n + 1);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const [slogan1, slogan2] = BRAND_SLOGAN.split(/(?<=\.)\s+/);

  const inputCls =
    'login-input block w-full h-12 px-3.5 text-[15px] text-white bg-white/[0.07] border border-white/20 rounded-xl hover:border-white/35 focus:outline-none focus:border-[#6fcf88] focus:bg-white/[0.1] focus:ring-4 focus:ring-[#3fa055]/25 transition-colors placeholder:text-[#a8cdb8]/70';

  return (
    <div className="login-bg relative min-h-screen overflow-hidden flex flex-col lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      {/* Stage: the live network of upazilas, behind the whole page */}
      <LoginStage busy={busy} className="absolute inset-0" />

      {/* Left column on wide screens / banner on narrow ones */}
      <section className="relative h-60 sm:h-72 lg:h-auto pointer-events-none">
        <div className="hidden lg:block absolute left-12 xl:left-16 bottom-14 z-10 max-w-md text-white">
          <h1 className="font-display text-3xl xl:text-4xl font-bold leading-[1.15] tracking-tight">
            {slogan1}
            <br />
            {slogan2}
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-emerald-100/75">
            Foreman connections, user IDs and forms for the 13 upazilas of Sylhet.
          </p>
        </div>
      </section>

      {/* Sign-in */}
      <main className="relative z-10 flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-8">
          <form
            key={shake}
            onSubmit={handleSubmit}
            className={`w-full max-w-[24rem] ${shake ? 'login-shake' : ''}`}
          >
            {/* Logo in a frosted-glass tile */}
            <div className="relative mx-auto mb-7 w-fit rounded-3xl border border-white/25 bg-white/[0.07] px-5 py-4 backdrop-blur-xl backdrop-saturate-150 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.35)]">
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-white/20 via-white/0 to-white/0" />
              <img
                src={logo}
                alt="Pace IT - Solution For Technology"
                width={557}
                height={751}
                draggable={false}
                className="relative block w-[96px] sm:w-[104px] [@media(max-height:700px)]:w-[84px] h-auto select-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
              />
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="username" className="block mb-1.5 text-sm font-medium text-[#dcefe3]">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoFocus={!username}
                  autoComplete="username"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="password" className="block mb-1.5 text-sm font-medium text-[#dcefe3]">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoFocus={Boolean(username)}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputCls} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 text-[#b9d8c6] hover:text-white"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Error & Rate-limiting feedback */}
            {error ? (
              <div className="mt-2.5 p-2.5 rounded-lg bg-[#3a1418]/70 border border-[#ef4444]/40 text-[#fecaca] text-xs leading-relaxed" role="alert">
                {error}
              </div>
            ) : (
              <p className="h-4 mt-1.5 text-xs text-transparent select-none">&nbsp;</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-3 block w-full h-12 text-[15px] font-semibold text-white bg-gradient-to-b from-[#35964a] to-[#2a7f35] hover:from-[#3da554] hover:to-[#30903c] active:from-[#2a7f35] active:to-[#2a7f35] border border-white/10 rounded-xl shadow-[0_10px_24px_-10px_rgba(63,160,85,0.8),inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors disabled:cursor-wait disabled:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b2f25] focus-visible:ring-[#6fcf88]"
            >
              {busy ? 'Authenticating...' : 'Sign In'}
            </button>
            <p className="mt-4 text-center text-xs text-[#a8cdb8]/80">For operators and admins</p>
          </form>
        </div>

        <DevelopedBy tone="dark" />
      </main>
    </div>
  );
};
