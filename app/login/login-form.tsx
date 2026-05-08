"use client";

import { signIn } from "next-auth/react";

const APPROVAL_MESSAGE = "관리자 승인이 필요합니다.";

function resolveErrorMessage(error: string | null): string | null {
  if (error === "approval_required") {
    return APPROVAL_MESSAGE;
  }

  if (error === "invalid_email") {
    return "유효한 이메일 정보를 확인할 수 없습니다. 관리자에게 문의하세요.";
  }

  if (error) {
    return "로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }

  return null;
}

export default function LoginForm({ error }: { error: string | null }) {
  const errorMessage = resolveErrorMessage(error);

  const handleGoogleAuth = async () => {
    await signIn("google", {
      callbackUrl: "/dashboard",
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-8 text-center text-3xl font-bold tracking-tight text-slate-900">
          CRMS 관리시스템
        </h1>

        {errorMessage && (
          <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {errorMessage}
          </p>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleGoogleAuth}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Google 계정으로 로그인
          </button>
        </div>
      </section>
    </main>
  );
}
