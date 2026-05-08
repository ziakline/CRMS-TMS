"use client";

import { useEffect, useMemo, useState } from "react";
import { formatKstDateTime } from "../../../lib/time";

type User = {
  user_id: number;
  email: string;
  name: string;
  is_approved: boolean;
  created_at: string;
};

function formatDateTime(value: string) {
  return formatKstDateTime(value);
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

  const pendingCount = useMemo(
    () => users.filter((user) => !user.is_approved).length,
    [users],
  );

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "사용자 목록 조회에 실패했습니다.");
      }

      const data = (await response.json()) as { users: User[] };
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "사용자 목록을 불러오는 중 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  const handleToggleApproval = async (user: User) => {
    const nextState = !user.is_approved;
    setUpdatingUserId(user.user_id);
    setError(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user.user_id,
          is_approved: nextState,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "승인 상태 변경에 실패했습니다.");
      }

      setUsers((prevUsers) =>
        prevUsers.map((prevUser) =>
          prevUser.user_id === user.user_id
            ? { ...prevUser, is_approved: nextState }
            : prevUser,
        ),
      );
    } catch (patchError) {
      setError(
        patchError instanceof Error
          ? patchError.message
          : "승인 상태 변경 중 오류가 발생했습니다.",
      );
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-8">
      <section className="mx-auto w-full max-w-6xl rounded-xl bg-white p-6 shadow-md sm:p-8">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-2xl font-bold text-slate-900">사용자 승인 관리</h1>
          <p className="text-sm text-slate-600">승인 대기 사용자: {pendingCount}명</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  이메일
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  이름
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  가입일시
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  상태
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-slate-500" colSpan={5}>
                    사용자 목록을 불러오는 중입니다...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-slate-500" colSpan={5}>
                    등록된 사용자가 없습니다.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.user_id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-800">
                      {user.email}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-800">
                      {user.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {formatDateTime(user.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {user.is_approved ? (
                        <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          승인됨
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                          대기중
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        disabled={updatingUserId === user.user_id}
                        onClick={() => void handleToggleApproval(user)}
                        className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {updatingUserId === user.user_id
                          ? "처리 중..."
                          : user.is_approved
                            ? "승인 취소"
                            : "승인"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
