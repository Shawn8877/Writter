"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { authRepository } from "@/lib/repositories/auth-repository";

export function AuthControls() {
  const [user, setUser] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = authRepository.subscribe((nextUser) => {
      changed = true;
      if (active) setUser(nextUser);
    });
    authRepository.getUser().then((nextUser) => {
      if (active && !changed) setUser(nextUser);
    }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);

  async function signOut() {
    setPending(true);
    setError("");
    try {
      await authRepository.signOut();
      // A fresh navigation drops any protected pages held by the Router cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Auth transitions intentionally clear the client cache.
      window.location.assign("/");
    } catch (failure) {
      setError(failure.message);
      setPending(false);
    }
  }

  if (!user) return <Link className="button button-small button-ghost" href="/login"><UserRound size={16} />登录</Link>;

  return (
    <div className="auth-controls">
      <span className="auth-email" title={user.email}>{user.email}</span>
      <button type="button" className="button button-small button-ghost" onClick={signOut} disabled={pending}>
        <LogOut size={15} />{pending ? "退出中…" : "退出"}
      </button>
      {error && <p className="auth-controls-error" role="alert">{error}</p>}
    </div>
  );
}
